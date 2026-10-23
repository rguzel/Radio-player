import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  Search,
  Radio,
  Heart,
  Globe,
  TrendingUp,
  ChevronDown,
  Sparkles,
  Zap,
  Coffee,
  Moon,
  Sun,
  AlertCircle,
  BarChart3,
  MapPin,
} from 'lucide-react';
import { RadioStation } from './types';
import { RadioService, uniqueStations } from './services/radioService';
import { getMoodTags } from './services/moodService';
import { PlayPeriod, PlayStatsService } from './services/playStatsService';
import { useFavorites } from './hooks/useFavorites';
import { useListenerCountries } from './hooks/useListenerCountries';
import { useNowPlaying } from './hooks/useNowPlaying';
import { useRadioPlayer } from './hooks/useRadioPlayer';
import { ListenerCountries } from './components/ListenerCountries';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { Equalizer } from './components/Equalizer';
import { fallbackToInitials, primaryTag, stationArtwork } from './utils/artwork';
import { updateMediaSession } from './utils/mediaSession';

const MOODS = [
  { id: 'focus', label: 'Focus', icon: <Zap size={16} /> },
  { id: 'chill', label: 'Chill', icon: <Coffee size={16} /> },
  { id: 'deep', label: 'Night', icon: <Moon size={16} /> },
  { id: 'energy', label: 'Vibe', icon: <Sun size={16} /> },
];

// How many of a mood's tags to query; results are merged and ranked by plays.
// A single country has far fewer stations per tag, so query all of them there.
const MOOD_TAG_COUNT = 3;
const MOOD_TAG_COUNT_IN_COUNTRY = Infinity;

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

type Tab = 'trending' | 'search' | 'favorites' | 'most' | 'listeners';

const PLAY_PERIODS: { id: PlayPeriod; label: string }[] = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'all', label: 'All time' },
];

/** A station in the Most Played list, with its play count for the period. */
type RankedStation = RadioStation & { plays?: number };
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

// Most played by Guzel Radio listeners (server/nowplaying keeps the counts),
// with station details from Radio Browser, in ranking order.
const fetchMostPlayed = (period: PlayPeriod): StationFetcher => async signal => {
  const ranking = await PlayStatsService.getMostPlayed(period, 50, signal);
  const details = await RadioService.getStationsByUuids(ranking.map(r => r.uuid), signal);
  const byUuid = new Map(details.map(station => [station.stationuuid, station]));
  return ranking.flatMap(({ uuid, plays }): RankedStation[] => {
    const station = byUuid.get(uuid);
    return station ? [{ ...station, plays }] : [];
  });
};

const fetchMood = (mood: string, country?: string): StationFetcher => async signal => {
  const tags = getMoodTags(mood).slice(0, country ? MOOD_TAG_COUNT_IN_COUNTRY : MOOD_TAG_COUNT);
  // One unavailable tag shouldn't empty the whole mood.
  const results = await Promise.allSettled(tags.map(tag => RadioService.getStationsByTag(tag, 20, country, signal)));
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
  const [playPeriod, setPlayPeriod] = useState<PlayPeriod>('day');
  // Count each real start: in Radio Browser (popularity/trending) and in our
  // own stats (Most Played). Both are fire-and-forget.
  const player = useRadioPlayer(station => {
    RadioService.reportClick(station.stationuuid).catch(() => {});
    PlayStatsService.recordPlay(station.stationuuid).catch(() => {});
  });
  const lastVolumeRef = useRef(player.volume || 0.8);
  const listeners = useListenerCountries(playPeriod, activeTab === 'listeners');

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

  const showMostPlayed = (period: PlayPeriod) => {
    setActiveTab('most');
    setActiveMood(null);
    setSelectedCountry('');
    setPlayPeriod(period);
    loadStations(fetchMostPlayed(period));
  };

  const showListeners = () => {
    setActiveTab('listeners');
    setActiveMood(null);
    setSelectedCountry('');
  };

  const selectPeriod = (period: PlayPeriod) => {
    if (activeTab === 'most') showMostPlayed(period);
    else setPlayPeriod(period);
  };

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
    loadStations(fetchMood(mood, selectedCountry || undefined));
  };

  const handleCountryFilter = (country: string) => {
    // With a mood showing, the country narrows (or widens) that mood.
    if (activeMood && activeTab === 'search') {
      setSelectedCountry(country);
      loadStations(fetchMood(activeMood, country || undefined));
      return;
    }
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
  const track = useNowPlaying(current, player.isPlaying);

  // Full-screen Now Playing sheet on small screens (the side panel is lg+ only).
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => updateMediaSession(current, track), [current, track]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheetOpen]);

  const nowPlayingPanel = (
    <NowPlayingPanel
      station={current}
      track={track}
      isPlaying={player.isPlaying}
      isBuffering={player.isBuffering}
      error={player.error}
      volume={player.volume}
      analyser={player.analyser}
      canSkip={canSkip}
      isFavorite={current ? isFavorite(current.stationuuid) : false}
      onTogglePlay={player.togglePlay}
      onSkip={player.skip}
      onVolumeChange={player.setVolume}
      onToggleMute={toggleMute}
      onToggleFavorite={() => current && toggleFavorite(current)}
      onVote={uuid => RadioService.vote(uuid)}
    />
  );

  return (
    <div className="min-h-screen relative flex flex-col pt-6 pb-24 lg:pb-6 px-4 overflow-hidden text-slate-100">
      <div className="atmosphere" />

      {/* Header */}
      <header className="flex justify-between items-center mb-10 px-2 max-w-[1480px] mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.4)]">
            <Radio size={24} className="text-black" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white italic">GUZEL<span className="text-accent not-italic">RADIO</span></h1>
        </div>
      </header>

      <div className="max-w-[1480px] mx-auto w-full flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8 lg:items-start">
      <main className="w-full flex flex-col min-w-0">
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-6">
          <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
            <TabButton
              active={activeTab === 'trending'}
              onClick={showTrending}
              icon={<TrendingUp size={16} />}
              label="Trending"
            />
            <TabButton
              active={activeTab === 'most'}
              onClick={() => showMostPlayed(playPeriod)}
              icon={<BarChart3 size={16} />}
              label="Most Played"
            />
            <TabButton
              active={activeTab === 'listeners'}
              onClick={showListeners}
              icon={<MapPin size={16} />}
              label="Listeners"
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
            className="self-start sm:self-auto bg-white/5 border border-white/10 text-sm text-slate-300 rounded-full px-4 py-2.5 focus:outline-none focus:border-accent/40 cursor-pointer shrink-0"
          >
            <option value="" className="bg-slate-900 text-slate-300">All Countries</option>
            {COUNTRIES.map(c => (
              <option key={c.value} value={c.value} className="bg-slate-900 text-slate-300">{c.label}</option>
            ))}
          </select>
        </div>

        {(activeTab === 'most' || activeTab === 'listeners') && (
          <div className="flex items-center gap-2 mb-6 -mt-2" role="group" aria-label="Statistics period">
            {PLAY_PERIODS.map(period => (
              <button
                key={period.id}
                onClick={() => selectPeriod(period.id)}
                aria-pressed={playPeriod === period.id}
                className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border transition-colors ${
                  playPeriod === period.id
                    ? 'bg-accent/10 border-accent/40 text-accent'
                    : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                }`}
              >
                {period.label}
              </button>
            ))}
            <span className="ml-2 text-[10px] text-slate-600 uppercase tracking-widest hidden sm:inline">By Guzel Radio listeners</span>
          </div>
        )}

        {/* Station List */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-5 pr-1 pb-32 lg:pb-8"
          aria-busy={activeTab === 'listeners' ? listeners.isLoading : showListLoading}
        >
          {activeTab === 'listeners' ? (
            listeners.isLoading ? (
              <StatusPanel
                icon={<div className="w-8 h-8 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />}
                title="Tuning in"
                message="Loading listener statistics..."
              />
            ) : listeners.error ? (
              <StatusPanel
                icon={<AlertCircle size={32} className="text-red-400/70" />}
                title="Signal lost"
                message={listeners.error}
                action={{ label: 'Try again', onClick: listeners.reload }}
              />
            ) : listeners.countries.length === 0 ? (
              <StatusPanel
                icon={<MapPin size={32} className="text-slate-700" />}
                title="No listeners yet"
                message={`Nobody has listened ${PLAY_PERIODS.find(p => p.id === playPeriod)?.label.toLowerCase() ?? ''} yet. Countries show up here as people start listening.`}
              />
            ) : (
              <ListenerCountries countries={listeners.countries} />
            )
          ) : showListLoading ? (
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
              title={activeTab === 'favorites' ? 'No favorites yet' : activeTab === 'most' ? 'No plays yet' : 'Aura silence'}
              message={activeTab === 'favorites'
                ? 'Tap the heart on any station to save it here.'
                : activeTab === 'most'
                  ? `Nothing has been played ${PLAY_PERIODS.find(p => p.id === playPeriod)?.label.toLowerCase() ?? ''} yet. Start listening and the most played stations will show up here.`
                : activeMood && selectedCountry
                  ? `No ${MOODS.find(m => m.id === activeMood)?.label ?? ''} stations found in ${selectedCountry}. Try another mood or country.`
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
                  plays={activeTab === 'most' ? (station as RankedStation).plays : undefined}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </main>

      {/* Now Playing side panel */}
      <aside className="hidden lg:block sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto thin-scroll">
        {nowPlayingPanel}
      </aside>
      </div>

      {/* Mini player (below lg); tap to open the full Now Playing sheet */}
      <AnimatePresence>
        {current && (
          <motion.footer
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            className="lg:hidden fixed bottom-0 left-0 right-0 z-50 h-24 bg-black/85 backdrop-blur-3xl border-t border-white/10 pl-4 pr-5 sm:px-8 flex items-center gap-4 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
          >
            <button
              onClick={() => setSheetOpen(true)}
              aria-label="Open now playing"
              aria-haspopup="dialog"
              className="flex-1 min-w-0 flex items-center gap-4 text-left"
            >
              <div className="w-14 h-14 bg-slate-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl shrink-0">
                <img
                  src={stationArtwork(current)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => fallbackToInitials(e, current.name)}
                />
              </div>
              <div className="min-w-0 flex-1" aria-live="polite">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    player.error ? 'bg-slate-500'
                      : player.isBuffering ? 'bg-amber-400 animate-pulse'
                      : player.isPlaying ? 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.5)]'
                      : 'bg-slate-500'
                  }`} />
                  <span className="text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">
                    {player.error ? 'Unavailable' : player.isBuffering ? 'Syncing...' : player.isPlaying ? 'Live' : 'Paused'}
                  </span>
                  <Equalizer analyser={null} active={player.isPlaying && !player.isBuffering && !player.error} bars={5} className="h-3.5 w-7 ml-1" />
                </div>
                <h4 className="font-bold text-sm text-white truncate">{current.name}</h4>
                <p className={`text-[11px] truncate ${player.error ? 'text-red-300/80' : 'text-slate-400'}`}>
                  {player.error
                    ?? (track ? `${track.artist ? `${track.artist} – ` : ''}${track.title}` : [current.codec, current.bitrate > 0 ? `${current.bitrate}kbps` : null].filter(Boolean).join(' · ') || 'Live')}
                </p>
              </div>
            </button>
            <button
              onClick={player.togglePlay}
              aria-label={player.isPlaying ? 'Pause' : 'Play'}
              className="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center shrink-0 shadow-[0_0_30px_rgba(255,255,255,0.15)] active:scale-95 transition-all glow-accent"
            >
              {player.isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-1" />}
            </button>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* Now Playing sheet (below lg) */}
      <AnimatePresence>
        {sheetOpen && current && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Now playing"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="lg:hidden fixed inset-0 z-[60] bg-[#050505] overflow-y-auto px-4 pt-4 pb-8"
          >
            <div className="max-w-md mx-auto">
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close now playing"
                autoFocus
                className="mb-4 p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <ChevronDown size={28} />
              </button>
              {nowPlayingPanel}
            </div>
          </motion.div>
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
  /** Play count shown in the Most Played list. */
  plays?: number;
  onPlay: () => void;
  onToggleFavorite: () => void;
}

const StationCard = React.forwardRef<HTMLDivElement, StationCardProps>(function StationCard(
  { station, isCurrent, isPlaying, isFavorite, plays, onPlay, onToggleFavorite },
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
              {plays !== undefined
                ? `${plays.toLocaleString()} ${plays === 1 ? 'play' : 'plays'}`
                : primaryTag(station) ?? 'broadcast'}
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
