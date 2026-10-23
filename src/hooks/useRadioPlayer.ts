import { useEffect, useRef, useState } from 'react';
import { RadioStation } from '../types';

const VOLUME_KEY = 'guzel_volume';
const DEFAULT_VOLUME = 0.8;

export interface PlayerState {
  currentStation: RadioStation | null;
  /** The user wants audio playing (may still be buffering). */
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
  volume: number;
  /** Number of stations in the list the current station was started from. */
  queueSize: number;
  /** Live frequency data for the equalizer; null when the stream doesn't allow it. */
  analyser: AnalyserNode | null;
}

type StateUpdate = (update: (state: PlayerState) => PlayerState) => void;
type StartListener = (station: RadioStation) => void;

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const value = raw === null ? NaN : Number(raw);
    return value >= 0 && value <= 1 ? value : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function streamUrl(station: RadioStation): string {
  return station.url_resolved || station.url;
}

/** HTTP-only stations can't play on an HTTPS page (mixed content). */
function needsRelay(station: RadioStation): boolean {
  return window.location.protocol === 'https:' && streamUrl(station).startsWith('http://');
}

/**
 * The URL the <audio> element should load. HTTP-only stations go through the
 * same-origin HTTPS relay (server/nowplaying, /api/stream); being same-origin,
 * relayed streams also get the real spectrum.
 */
function playbackUrl(station: RadioStation): string {
  return needsRelay(station)
    ? `/api/stream?uuid=${encodeURIComponent(station.stationuuid)}`
    : streamUrl(station);
}

function isBlockedByBrowser(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

function describeError(station: RadioStation | null, error?: unknown): string {
  if (isBlockedByBrowser(error)) {
    return 'Playback was blocked by the browser. Press play to start.';
  }
  if (station && needsRelay(station)) {
    return 'This station only streams over HTTP and could not be reached through the secure relay.';
  }
  return 'This station is offline or uses a format your browser cannot play.';
}

/**
 * Whether to try routing audio through Web Audio for a real spectrum.
 * Only on wide screens (where the equalizer panel shows), and never on iOS,
 * where Web Audio is suspended when the screen locks and would cut the radio.
 */
function spectrumSupported(): boolean {
  if (typeof AudioContext === 'undefined') return false;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !isIOS && window.matchMedia('(min-width: 1024px)').matches;
}

/**
 * Live radio playback outside React: audio elements, skip queue and volume.
 *
 * Two <audio> elements are used. Reading a stream's frequency data requires it
 * to be loaded with CORS, which many radio servers don't allow; and once an
 * element is wired into Web Audio, a non-CORS stream on it plays as silence.
 * So each station is first tried on the CORS + analyser element and, if that
 * fails to load, replayed on a plain element (the equalizer then animates
 * without real data).
 */
class PlaybackEngine {
  private plain: HTMLAudioElement | null = null;
  private analysed: HTMLAudioElement | null = null;
  private graph: { context: AudioContext; analyser: AnalyserNode; gain: GainNode } | null = null;
  private active: HTMLAudioElement | null = null;
  /** Whether the active element has started playing since its last load. */
  private started = false;
  private current: RadioStation | null = null;
  private queue: RadioStation[] = [];
  /** Whether onStart has fired for the current play() (not on rebuffering). */
  private reported = false;

  constructor(
    private readonly update: StateUpdate,
    private volume: number,
    private readonly onStart: StartListener,
  ) {}

  play(station: RadioStation, queue: RadioStation[] = this.queue) {
    this.current = station;
    this.reported = false;
    this.queue = queue;
    this.update(s => ({ ...s, currentStation: station, isPlaying: true, isBuffering: true, error: null, queueSize: queue.length }));
    this.start(this.getAnalysed() ?? this.getPlain(), station);
  }

  pause() {
    this.active?.pause();
  }

  // Live streams are reloaded on resume rather than continuing from the paused
  // buffer, which would otherwise play minutes-old audio.
  resume() {
    if (this.current) this.play(this.current);
  }

  togglePlay() {
    if (!this.active || this.active.paused) this.resume();
    else this.pause();
  }

  skip(offset: 1 | -1) {
    const index = this.queue.findIndex(s => s.stationuuid === this.current?.stationuuid);
    if (this.queue.length < 2 || index === -1) return;
    this.play(this.queue[(index + offset + this.queue.length) % this.queue.length]);
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.plain) this.plain.volume = volume;
    if (this.graph) this.graph.gain.gain.value = volume;
  }

  dispose() {
    this.plain?.pause();
    this.analysed?.pause();
  }

  private start(audio: HTMLAudioElement, station: RadioStation) {
    const previous = this.active;
    if (previous && previous !== audio) {
      previous.pause();
      previous.removeAttribute('src');
      previous.load(); // drop the old connection
    }
    this.active = audio;
    this.started = false;

    const analyser = audio === this.analysed ? this.graph?.analyser ?? null : null;
    if (analyser) void this.graph?.context.resume();
    this.update(s => ({ ...s, analyser }));

    audio.src = playbackUrl(station);
    audio.play().catch(error => {
      // AbortError just means a newer play()/pause() superseded this one.
      if (error?.name !== 'AbortError') this.handleFailure(audio, error);
    });
  }

  private handleFailure(audio: HTMLAudioElement, error?: unknown) {
    if (audio !== this.active) return;
    if (audio === this.analysed && !this.started && !isBlockedByBrowser(error) && this.current) {
      // Most likely the stream doesn't allow CORS; play it without the analyser.
      this.start(this.getPlain(), this.current);
      return;
    }
    this.update(s => ({ ...s, isPlaying: false, isBuffering: false, error: describeError(this.current, error) }));
  }

  private wire(audio: HTMLAudioElement): HTMLAudioElement {
    const onActive = (handler: () => void) => () => {
      if (audio === this.active) handler();
    };
    audio.addEventListener('play', onActive(() => this.update(s => ({ ...s, isPlaying: true }))));
    audio.addEventListener('playing', onActive(() => {
      this.started = true;
      if (!this.reported && this.current) {
        this.reported = true;
        this.onStart(this.current);
      }
      this.update(s => ({ ...s, isPlaying: true, isBuffering: false, error: null }));
    }));
    audio.addEventListener('waiting', onActive(() => this.update(s => ({ ...s, isBuffering: true }))));
    audio.addEventListener('pause', onActive(() => this.update(s => ({ ...s, isPlaying: false, isBuffering: false }))));
    audio.addEventListener('error', () => this.handleFailure(audio));
    return audio;
  }

  private getPlain(): HTMLAudioElement {
    if (!this.plain) {
      this.plain = this.wire(new Audio());
      this.plain.volume = this.volume;
    }
    return this.plain;
  }

  /** The CORS element routed through an analyser, or null if unavailable. */
  private getAnalysed(): HTMLAudioElement | null {
    if (this.analysed || !spectrumSupported()) return this.analysed;
    try {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      // Volume is applied after the analyser so the equalizer keeps moving when muted.
      const gain = context.createGain();
      gain.gain.value = this.volume;
      context.createMediaElementSource(audio).connect(analyser).connect(gain).connect(context.destination);
      this.graph = { context, analyser, gain };
      this.analysed = this.wire(audio);
    } catch {
      this.graph = null;
    }
    return this.analysed;
  }
}

/**
 * @param onStart called once each time a station actually starts playing
 *   (audio flowing, not just requested), e.g. to count plays.
 */
export function useRadioPlayer(onStart?: StartListener) {
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;

  const [state, setState] = useState<PlayerState>(() => ({
    currentStation: null,
    isPlaying: false,
    isBuffering: false,
    error: null,
    volume: loadVolume(),
    queueSize: 0,
    analyser: null,
  }));

  const engineRef = useRef<PlaybackEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PlaybackEngine(setState, state.volume, station => onStartRef.current?.(station));
  }
  const engine = engineRef.current;

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    engine.setVolume(state.volume);
    try {
      localStorage.setItem(VOLUME_KEY, String(state.volume));
    } catch {
      // Storage blocked; volume just won't be remembered.
    }
  }, [engine, state.volume]);

  // Lock-screen / OS media controls.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => engine.resume()],
      ['pause', () => engine.pause()],
      ['stop', () => engine.pause()],
      ['nexttrack', () => engine.skip(1)],
      ['previoustrack', () => engine.skip(-1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Ignore
        }
      }
    };
  }, [engine]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !state.currentStation) return;
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
  }, [state.isPlaying, state.currentStation]);

  const [actions] = useState(() => ({
    play: (station: RadioStation, queue?: RadioStation[]) => engine.play(station, queue),
    togglePlay: () => engine.togglePlay(),
    skip: (offset: 1 | -1) => engine.skip(offset),
    setVolume: (volume: number) => setState(s => ({ ...s, volume })),
  }));

  return { ...state, ...actions };
}
