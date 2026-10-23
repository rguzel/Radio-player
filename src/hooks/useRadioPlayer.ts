import { useCallback, useEffect, useRef, useState } from 'react';
import { RadioStation } from '../types';
import { primaryTag, stationArtwork } from '../utils/artwork';

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
}

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

function describeError(station: RadioStation | null, error?: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Playback was blocked by the browser. Press play to start.';
  }
  if (station && window.location.protocol === 'https:' && streamUrl(station).startsWith('http://')) {
    return 'This station only streams over insecure HTTP, which browsers block on secure sites.';
  }
  return 'This station is offline or uses a format your browser cannot play.';
}

function updateMediaMetadata(station: RadioStation) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: 'Guzel Radio',
    album: [station.country, primaryTag(station)?.toUpperCase() ?? 'Live'].filter(Boolean).join(' • '),
    artwork: [{ src: stationArtwork(station), sizes: '512x512' }],
  });
}

/**
 * Owns the <audio> element for live radio playback, including the queue used
 * by skip next/previous and the Media Session (lock screen / OS controls).
 */
export function useRadioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentRef = useRef<RadioStation | null>(null);
  const queueRef = useRef<RadioStation[]>([]);

  const [state, setState] = useState<PlayerState>(() => ({
    currentStation: null,
    isPlaying: false,
    isBuffering: false,
    error: null,
    volume: loadVolume(),
    queueSize: 0,
  }));

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const fail = useCallback((error?: unknown) => {
    setState(s => ({ ...s, isPlaying: false, isBuffering: false, error: describeError(currentRef.current, error) }));
  }, []);

  const play = useCallback((station: RadioStation, queue: RadioStation[] = queueRef.current) => {
    const audio = getAudio();
    currentRef.current = station;
    queueRef.current = queue;
    setState(s => ({ ...s, currentStation: station, isPlaying: true, isBuffering: true, error: null, queueSize: queue.length }));
    updateMediaMetadata(station);

    audio.src = streamUrl(station);
    audio.play().catch(error => {
      // AbortError just means a newer play()/pause() superseded this one.
      if (error?.name !== 'AbortError') fail(error);
    });
  }, [getAudio, fail]);

  const pause = useCallback(() => {
    getAudio().pause();
  }, [getAudio]);

  // Live streams are reloaded on resume rather than continuing from the paused
  // buffer, which would otherwise play minutes-old audio.
  const resume = useCallback(() => {
    if (currentRef.current) play(currentRef.current);
  }, [play]);

  const togglePlay = useCallback(() => {
    if (getAudio().paused) resume();
    else pause();
  }, [getAudio, pause, resume]);

  const skip = useCallback((offset: 1 | -1) => {
    const queue = queueRef.current;
    const index = queue.findIndex(s => s.stationuuid === currentRef.current?.stationuuid);
    if (queue.length < 2 || index === -1) return;
    play(queue[(index + offset + queue.length) % queue.length]);
  }, [play]);

  const setVolume = useCallback((volume: number) => {
    setState(s => ({ ...s, volume }));
  }, []);

  // Audio element events
  useEffect(() => {
    const audio = getAudio();
    const onPlay = () => setState(s => ({ ...s, isPlaying: true }));
    const onPlaying = () => setState(s => ({ ...s, isPlaying: true, isBuffering: false, error: null }));
    const onWaiting = () => setState(s => ({ ...s, isBuffering: true }));
    const onPause = () => setState(s => ({ ...s, isPlaying: false, isBuffering: false }));
    const onError = () => fail();

    audio.addEventListener('play', onPlay);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  }, [getAudio, fail]);

  // Stop audio if the app unmounts.
  useEffect(() => () => audioRef.current?.pause(), []);

  useEffect(() => {
    getAudio().volume = state.volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(state.volume));
    } catch {
      // Storage blocked; volume just won't be remembered.
    }
  }, [getAudio, state.volume]);

  // Media Session handlers are registered once and read the latest station and
  // queue through refs, so lock-screen skip always uses the current list.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', resume],
      ['pause', pause],
      ['stop', pause],
      ['nexttrack', () => skip(1)],
      ['previoustrack', () => skip(-1)],
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
  }, [resume, pause, skip]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !state.currentStation) return;
    navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
  }, [state.isPlaying, state.currentStation]);

  return { ...state, play, togglePlay, skip, setVolume };
}
