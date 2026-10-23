import React from 'react';
import {
  ExternalLink, Heart, Music2, Pause, Play, Radio, SkipBack, SkipForward, Volume2, VolumeX,
} from 'lucide-react';
import { RadioStation } from '../types';
import type { TrackInfo } from '../hooks/useNowPlaying';
import { fallbackToInitials, stationArtwork } from '../utils/artwork';
import { countryName } from '../utils/countries';
import { Equalizer } from './Equalizer';
import { StationVotes } from './StationVotes';

interface NowPlayingPanelProps {
  station: RadioStation | null;
  track: TrackInfo | null;
  isPlaying: boolean;
  isBuffering: boolean;
  error: string | null;
  volume: number;
  analyser: AnalyserNode | null;
  canSkip: boolean;
  isFavorite: boolean;
  onTogglePlay: () => void;
  onSkip: (offset: 1 | -1) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleFavorite: () => void;
  onVote: (uuid: string) => Promise<{ ok: boolean; message: string }>;
}

/** Only http(s) homepages are linked; the directory is user-submitted data. */
function safeHomepage(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function titleCase(list: string | undefined): string | null {
  const items = list?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  if (items.length === 0) return null;
  return items.map(s => s.replace(/\b\p{L}/gu, ch => ch.toUpperCase())).join(', ');
}

const numberFormat = new Intl.NumberFormat();

export function NowPlayingPanel(props: NowPlayingPanelProps) {
  const { station, track, isPlaying, isBuffering, error, volume, analyser, canSkip, isFavorite } = props;

  if (!station) {
    return (
      <section aria-label="Now playing" className="glass rounded-[2rem] p-8 text-center">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
          <Radio size={36} className="text-slate-700" />
        </div>
        <h2 className="text-slate-300 font-bold mb-2 uppercase tracking-widest text-xs">Nothing playing</h2>
        <p className="text-xs text-slate-500 leading-relaxed">Pick a station to start listening. What's on air will show up here.</p>
        <Equalizer analyser={null} active={false} className="w-full h-12 mt-8 opacity-40" />
      </section>
    );
  }

  const status = error ? 'Unavailable' : isBuffering ? 'Syncing...' : isPlaying ? 'Live' : 'Paused';
  const tags = station.tags?.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8) ?? [];
  const homepage = safeHomepage(station.homepage);
  const format = [station.codec?.toUpperCase(), station.bitrate > 0 ? `${station.bitrate} kbps` : null].filter(Boolean).join(' · ');
  const details: [string, string | null][] = [
    ['Country', station.countrycode ? countryName(station.countrycode) : station.country || null],
    ['Language', titleCase(station.language)],
    ['Format', format || null],
    // Radio Browser's clickcount is a rolling 24-hour count.
    ['Plays (24 h)', station.clickcount > 0 ? numberFormat.format(station.clickcount) : null],
  ];

  return (
    <section aria-label="Now playing" className="glass rounded-3xl lg:rounded-[2rem] p-4 sm:p-6 flex flex-col gap-4 sm:gap-5">
      {/* Artwork */}
      <div className="relative w-full max-w-[220px] sm:max-w-[260px] lg:max-w-[200px] mx-auto aspect-square rounded-3xl overflow-hidden bg-slate-900 border border-white/10 shadow-2xl shadow-black/60">
        <img
          src={stationArtwork(station)}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => fallbackToInitials(e, station.name)}
        />
      </div>

      {/* Station + status */}
      <div className="text-center" aria-live="polite">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${
            error ? 'bg-slate-500'
              : isBuffering ? 'bg-amber-400 animate-pulse'
              : isPlaying ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.6)]'
              : 'bg-slate-500'
          }`} />
          <span className="text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">{status}</span>
        </div>
        <h2 className="text-xl font-bold text-white leading-tight break-words">{station.name}</h2>
      </div>

      {/* What's on air */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/5 px-4 py-3 min-h-[68px] flex items-center gap-3" aria-live="polite">
        <div className="w-9 h-9 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
          <Music2 size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-black tracking-[0.2em] text-slate-500 uppercase mb-0.5">On air</p>
          {error ? (
            <p className="text-xs text-red-300/80 leading-snug">{error}</p>
          ) : track ? (
            <>
              <p className="text-sm font-semibold text-slate-100 truncate" title={track.title}>{track.title}</p>
              {track.artist && <p className="text-xs text-slate-400 truncate" title={track.artist}>{track.artist}</p>}
            </>
          ) : (
            <p className="text-xs text-slate-500">Track info isn't available for this station.</p>
          )}
        </div>
      </div>

      {/* Equalizer */}
      <div>
        <Equalizer analyser={analyser} active={isPlaying && !isBuffering && !error} className="w-full h-14" />
        <p className="mt-2 text-[9px] font-bold tracking-[0.2em] uppercase text-slate-600 text-right">
          {analyser ? 'Live spectrum' : 'Visualizer'}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <IconButton label={isFavorite ? 'Remove from favorites' : 'Add to favorites'} pressed={isFavorite} onClick={props.onToggleFavorite}>
          <Heart size={20} className={isFavorite ? 'text-accent' : ''} fill={isFavorite ? 'currentColor' : 'none'} />
        </IconButton>
        <div className="flex items-center gap-4">
          <IconButton label="Previous station" disabled={!canSkip} onClick={() => props.onSkip(-1)}>
            <SkipBack size={22} />
          </IconButton>
          <button
            onClick={props.onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:scale-105 active:scale-95 transition-all glow-accent"
          >
            {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="ml-1" />}
          </button>
          <IconButton label="Next station" disabled={!canSkip} onClick={() => props.onSkip(1)}>
            <SkipForward size={22} />
          </IconButton>
        </div>
        <IconButton label={volume > 0 ? 'Mute' : 'Unmute'} onClick={props.onToggleMute}>
          {volume > 0 ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </IconButton>
      </div>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => props.onVolumeChange(Number(e.target.value))}
        aria-label="Volume"
        className="w-full accent-accent cursor-pointer -mt-2"
      />

      {/* Details */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/5 pt-5">
        <StationVotes key={station.stationuuid} station={station} onVote={props.onVote} />
        {details.filter(([, value]) => value).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[9px] font-black tracking-[0.2em] text-slate-600 uppercase">{label}</dt>
            <dd className="text-xs text-slate-300 font-medium truncate" title={value ?? undefined}>{value}</dd>
          </div>
        ))}
      </dl>

      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Genres">
          {tags.map(tag => (
            <li key={tag} className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-white/5 border border-white/5 rounded-full px-3 py-1">
              {tag}
            </li>
          ))}
        </ul>
      )}

      {homepage && (
        <a
          href={homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-accent transition-colors"
        >
          Station website <ExternalLink size={14} />
        </a>
      )}
    </section>
  );
}

function IconButton({ label, pressed, disabled, onClick, children }: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      className="p-3 rounded-2xl text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors active:scale-90"
    >
      {children}
    </button>
  );
}
