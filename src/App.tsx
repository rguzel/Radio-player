import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  Search,
  Radio,
  Heart,
  Volume2,
  VolumeX,
  Globe,
  TrendingUp,
  SkipForward,
  SkipBack,
  Sparkles,
  Zap,
  Coffee,
  Moon,
  Sun,
  AlertCircle,
} from 'lucide-react';
import { RadioStation } from './types';
import { RadioService, uniqueStations } from './services/radioService';
import { getMoodTags } from './services/moodService';
import { useFavorites } from './hooks/useFavorites';
import { useRadioPlayer } from './hooks/useRadioPlayer';
import { fallbackToInitials, primaryTag, stationArtwork } from './utils/artwork';

const MOODS = [
  { id: 'focus', label: 'Focus', icon: <Zap size={16} /> },
  { id: 'chill', label: 'Chill', icon: <Coffee size={16} /> },
  { id: 'deep', label: 'Night', icon: <Moon size={16} /> },
  { id: 'energy', label: 'Vibe', icon: <Sun size={16} /> },
];

// How many of a mood's tags to query; results are merged and ranked by plays.
const MOOD_TAG_COUNT = 3;

const COUNTRIES = [
  { label: 'Canada', value: 'Canada' },
  { label: 'Türkiye', value: 'Türkiye' },
  { label: 'Australia', value: 'Australia' },
  { label: 'Brazil', value: 'Brazil' },
  { label: 'France', value: 'France' },
  { label: 'Germany', value: 'Germany' },
  { label: 'India', value: 'India' },
  { label: 'Italy', value: 'Italy' },
  { label: 'Japan', value: 'Japan' },
  { label: 'Netherlands', value: 'Netherlands' },
  { label: 'Spain', value: 'Spain' },
  { label: 'United Kingdom', value: 'United Kingdom' },
  { label: 'United States', value: 'United States' },
];

type Tab = 'trending' | 'search' | 'favorites';
type StationFetcher = (signal: AbortSignal) => Promise<RadioStation[]>;

const fetchTrending: StationFetcher = async signal => {
  // Prioritize Canada and Türkiye stations
  const [ca, tr, top] = await Promise.all([
    RadioService.getStationsByCountry('Canada', 15, signal),
    RadioService.getStationsByCountry('Türkiye', 15, signal),
    RadioService.getTopStations(20, signal),
  ]);
  return uniqueStations([...ca, ...tr, ...top]);
};

const fetchMood = (mood: string): StationFetcher => async signal => {
  const tags = getMoodTags(mood).slice(0, MOOD_TAG_COUNT);
  // One unavailable tag shouldn't empty the whole mood.
  const results = await Promise.allSettled(tags.map(tag => RadioService.getStationsByTag(tag, 20, signal)));
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<RadioStation[]> => r.status === 'fulfilled');
  if (fulfilled.length === 0) throw (results[0] as PromiseRejectedResult).reason;
  return uniqueStations(fulfilled.flatMap(r => r.value))
    .sort((a, b) => b.clickcount - a.clickcount)
    .slice(0, 30);
};

export default function App() {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('trending');
  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState('');

  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  const player = useRadioPlayer();
  const lastVolumeRef = useRef(player.volume || 0.8);

  // Only the most recent request may update the list; starting a new one
  // cancels the previous, so a slow response can't overwrite a newer one.
  const requestRef = useRef<AbortController | null>(null);
  const lastFetcherRef = useRef<StationFetcher>(fetchTrending);

  const loadStations = useCallback(async (fetcher: StationFetcher) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    lastFetcherRef.current = fetcher;
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await fetcher(controller.signal);
      if (!controller.signal.aborted) setStations(data);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Failed to load stations:', error);
      setStations([]);
      setLoadError('Could not reach the station directory. Check your connection and try again.');
    } finally {
      if (requestRef.current === controller) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStations(fetchTrending);
    return () => requestRef.current?.abort();
  }, [loadStations]);

  const showTrending = () => {
    setActiveTab('trending');
    setActiveMood(null);
    setSelectedCountry('');
    loadStations(fetchTrending);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    setActiveTab('search');
    setActiveMood(null);
    loadStations(signal => RadioService.searchStations(query, 50, selectedCountry || undefined, signal));
  };

  const handleMoodSelect = (mood: string) => {
    setActiveMood(mood);
    setActiveTab('search');
    loadStations(fetchMood(mood));
  };

  const handleCountryFilter = (country: string) => {
    if (!country) {
      showTrending();
      return;
    }
    setSelectedCountry(country);
    setActiveTab('search');
    setActiveMood(null);
    loadStations(signal => RadioService.getStationsByCountry(country, 50, signal));
  };

  const toggleMute = () => {
    if (player.volume > 0) {
      lastVolumeRef.current = player.volume;
      player.setVolume(0);
    } else {
      player.setVolume(lastVolumeRef.current || 0.8);
    }
  };

  const visibleStations = activeTab === 'favorites' ? favorites : stations;
  const showListLoading = isLoading && activeTab !== 'favorites';
  const showListError = loadError !== null && activeTab !== 'favorites';
  const canSkip = player.queueSize > 1;
  const current = player.currentStation;

  return (
    <div className="min-h-screen relative flex flex-col pt-6 pb-24 px-4 overflow-hidden text-slate-100">
      <div className="atmosphere" />

      {/* Header */}
      <header className="flex justify-between items-center mb-10 px-2 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.4)]">
            <Radio size={24} className="text-black" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white italic">GUZEL<span className="text-accent not-italic">RADIO</span></h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0">
        {/* Main Search Bar */}
        <div className="relative mb-8 group">
          <form onSubmit={handleSearch} role="search" className="relative z-10 w-full">
            <input
              type="search"
              aria-label="Search stations"
              placeholder="Search 50,000+ stations worldwide..."
              className="w-full h-16 bg-white/5 border border-white/5 rounded-2xl px-14 focus:outline-none focus:border-accent/40 focus:bg-white/8 transition-all placeholder:text-slate-600 text-sm font-medium"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-accent transition-colors" size={22} />
          </form>
          <div className="absolute inset-0 bg-accent/5 blur-3xl opacity-0 transition-opacity group-focus-within:opacity-100" />
        </div>

        {/* Mood Discovery */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4 px-1">
            <Sparkles size={14} className="text-accent" />
            <h2 className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Moods</h2>
          </div>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
            {MOODS.map(mood => {
              const isActive = activeMood === mood.id;
              const isLoadingMood = isActive && isLoading;
              return (
                <button
                  key={mood.id}
                  onClick={() => handleMoodSelect(mood.id)}
                  aria-pressed={isActive}
                  className={`flex items-center gap-3 px-6 py-3 rounded-2xl transition-all border shrink-0 ${
                    isActive
                      ? 'bg-accent/10 border-accent/40 text-accent shadow-[0_0_20px_rgba(245,158,11,0.1)]'
                      : 'bg-white/5 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200'
                  } ${isLoadingMood ? 'animate-pulse' : ''}`}
                >
                  {isLoadingMood ? (
                    <div className="w-4 h-4 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
                  ) : mood.icon}
                  <span className="text-xs font-bold tracking-wider uppercase">{mood.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabs & Filters */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
            <TabButton
              active={activeTab === 'trending'}
              onClick={showTrending}
              icon={<TrendingUp size={16} />}
              label="Trending"
            />
            <TabButton
              active={activeTab === 'favorites'}
              onClick={() => { setActiveTab('favorites'); setActiveMood(null); }}
              icon={<Heart size={16} />}
              label="Favorites"
            />
            <TabButton
              active={activeTab === 'search'}
              onClick={() => setActiveTab('search')}
              icon={<Globe size={16} />}
              label="Discovery"
            />
          </div>
          <select
            aria-label="Filter by country"
            value={selectedCountry}
            onChange={(e) => handleCountryFilter(e.target.value)}
            className="bg-white/5 border border-white/10 text-sm text-slate-300 rounded-full px-4 py-2.5 focus:outline-none focus:border-accent/40 cursor-pointer shrink-0"
          >
            <option value="" className="bg-slate-900 text-slate-300">All Countries</option>
            {COUNTRIES.map(c => (
              <option key={c.value} value={c.value} className="bg-slate-900 text-slate-300">{c.label}</option>
            ))}
          </select>
        </div>

        {/* Station List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 overflow-y-auto pr-1 thin-scroll pb-32" aria-busy={showListLoading}>
          {showListLoading ? (
            <StatusPanel
              icon={<div className="w-8 h-8 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />}
              title="Tuning in"
              message="Loading stations..."
            />
          ) : showListError ? (
            <StatusPanel
              icon={<AlertCircle size={32} className="text-red-400/70" />}
              title="Signal lost"
              message={loadError ?? ''}
              action={{ label: 'Try again', onClick: () => loadStations(lastFetcherRef.current) }}
            />
          ) : visibleStations.length === 0 ? (
            <StatusPanel
              icon={<Radio size={32} className="text-slate-700" />}
              title={activeTab === 'favorites' ? 'No favorites yet' : 'Aura silence'}
              message={activeTab === 'favorites'
                ? 'Tap the heart on any station to save it here.'
                : 'No stations match your current frequency. Try another search.'}
            />
          ) : (
            <AnimatePresence mode="popLayout">
              {visibleStations.map(station => (
                <StationCard
                  key={station.stationuuid}
                  station={station}
                  isCurrent={current?.stationuuid === station.stationuuid}
                  isPlaying={player.isPlaying}
                  isFavorite={isFavorite(station.stationuuid)}
                  onPlay={() => player.play(station, visibleStations)}
                  onToggleFavorite={() => toggleFavorite(station)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* Footer / Large Player Controls */}
      <AnimatePresence>
        {current && (
          <motion.footer
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-50 h-28 bg-black/85 backdrop-blur-3xl border-t border-white/10 px-6 sm:px-10 flex items-center justify-between shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center gap-5 sm:w-1/3 min-w-0">
              <div className="hidden sm:block w-16 h-16 bg-slate-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl shrink-0">
                <img
                  src={stationArtwork(current)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => fallbackToInitials(e, current.name)}
                />
              </div>
              <div className="min-w-0" aria-live="polite">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-2 h-2 rounded-full ${
                    player.error ? 'bg-slate-500'
                      : player.isBuffering ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.5)]'
                  }`} />
                  <span className="text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">
                    {player.error ? 'Unavailable' : player.isBuffering ? 'Syncing...' : player.isPlaying ? 'Live Stream' : 'Paused'}
                  </span>
                </div>
                <h4 className="font-bold text-base text-white truncate max-w-[200px] sm:max-w-[280px]">{current.name}</h4>
                {player.error ? (
                  <p className="text-[11px] text-red-300/80 truncate max-w-[220px] sm:max-w-[320px]" title={player.error}>{player.error}</p>
                ) : (
                  <div className="flex items-center gap-3">
                    {current.codec && (
                      <>
                        <p className="text-[10px] text-accent font-bold uppercase tracking-widest">{current.codec}</p>
                        <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                      </>
                    )}
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                      {current.bitrate > 0 ? `${current.bitrate}kbps` : 'Live'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-6 lg:gap-12">
              <button
                onClick={() => player.skip(-1)}
                disabled={!canSkip}
                aria-label="Previous station"
                className="hidden sm:block p-3 text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors active:scale-90"
              >
                <SkipBack size={24} />
              </button>
              <button
                onClick={player.togglePlay}
                aria-label={player.isPlaying ? 'Pause' : 'Play'}
                className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:scale-105 active:scale-95 transition-all glow-accent relative z-10"
              >
                {player.isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
              </button>
              <button
                onClick={() => player.skip(1)}
                disabled={!canSkip}
                aria-label="Next station"
                className="hidden sm:block p-3 text-slate-500 hover:text-white disabled:opacity-30 disabled:hover:text-slate-500 transition-colors active:scale-90"
              >
                <SkipForward size={24} />
              </button>
            </div>

            <div className="hidden lg:flex w-1/3 justify-end items-center gap-4">
              <button
                onClick={toggleMute}
                aria-label={player.volume > 0 ? 'Mute' : 'Unmute'}
                className="text-slate-500 hover:text-white transition-colors"
              >
                {player.volume > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="w-28 accent-accent cursor-pointer"
              />
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </div>
  );
}

interface StationCardProps {
  station: RadioStation;
  isCurrent: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
}

const StationCard = React.forwardRef<HTMLDivElement, StationCardProps>(function StationCard(
  { station, isCurrent, isPlaying, isFavorite, onPlay, onToggleFavorite },
  ref
) {
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`group relative p-5 glass rounded-[2.5rem] flex items-center gap-5 hover:border-white/15 hover:bg-white/[0.04] transition-all duration-300 ${
        isCurrent ? 'border-accent/40 bg-accent/[0.03] ring-1 ring-accent/20' : ''
      }`}
    >
      <button
        onClick={onPlay}
        aria-label={`Play ${station.name}`}
        aria-current={isCurrent || undefined}
        className="flex-1 min-w-0 flex items-center gap-5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-2xl"
      >
        <div className="relative w-16 h-16 flex-shrink-0">
          <img
            src={stationArtwork(station)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover rounded-2xl bg-slate-900 border border-white/5 shadow-lg shadow-black/40"
            onError={(e) => fallbackToInitials(e, station.name)}
          />
          {isCurrent && isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-2xl backdrop-blur-[2px]">
              <div className="flex gap-1 items-end h-5">
                <motion.div animate={{ height: [4, 16, 8] }} transition={{ duration: 0.5, repeat: Infinity }} className="w-1 bg-accent rounded-full" />
                <motion.div animate={{ height: [8, 4, 16] }} transition={{ duration: 0.6, repeat: Infinity }} className="w-1 bg-accent rounded-full" />
                <motion.div animate={{ height: [12, 16, 4] }} transition={{ duration: 0.4, repeat: Infinity }} className="w-1 bg-accent rounded-full" />
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-black text-accent tracking-tighter bg-accent/10 px-2 py-0.5 rounded-full uppercase">Live</span>
            <span className="text-[9px] text-slate-500 font-bold tracking-[0.15em] uppercase truncate">{station.country}</span>
          </div>
          <h3 className="font-bold truncate text-[14px] text-slate-100 group-hover:text-accent transition-colors duration-300">{station.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-500 font-medium truncate uppercase tracking-widest">
              {primaryTag(station) ?? 'broadcast'}
            </span>
          </div>
        </div>
      </button>
      <button
        onClick={onToggleFavorite}
        aria-label={isFavorite ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}
        aria-pressed={isFavorite}
        className={`p-3 rounded-2xl transition-all ${
          isFavorite ? 'text-accent bg-accent/10' : 'text-slate-700 hover:text-slate-300 hover:bg-white/5'
        }`}
      >
        <Heart size={18} fill={isFavorite ? 'currentColor' : 'none'} />
      </button>
    </motion.div>
  );
});

function StatusPanel({ icon, title, message, action }: {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="col-span-full py-24 text-center border border-white/5 bg-white/[0.02] rounded-[2.5rem]"
    >
      <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
        {icon}
      </div>
      <h3 className="text-slate-300 font-bold mb-2 uppercase tracking-widest text-xs">{title}</h3>
      <p className="text-xs text-slate-500 max-w-[240px] mx-auto leading-relaxed">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-6 px-5 py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all whitespace-nowrap ${
        active
          ? 'bg-accent text-white shadow-lg shadow-accent/20'
          : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'
      }`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
