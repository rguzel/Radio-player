import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  Search,
  Radio,
  Heart,
  Compass,
  TrendingUp,
  ChevronDown,
  Sparkles,
  Zap,
  Coffee,
  Moon,
  Sun,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import { RadioStation } from './types';
import { RadioService, uniqueStations } from './services/radioService';
import { getMoodTags } from './services/moodService';
import { PlayPeriod, PlayStatsService } from './services/playStatsService';
import { useFavorites } from './hooks/useFavorites';
import { useNowPlaying } from './hooks/useNowPlaying';
import { useRadioPlayer } from './hooks/useRadioPlayer';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { Equalizer } from './components/Equalizer';
import { BottomNav, NavItem } from './components/BottomNav';
import { CountryPicker, Flag } from './components/CountryPicker';
import { countryName } from './utils/countries';
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

type Tab = 'trending' | 'search' | 'favorites' | 'most';

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
    RadioService.getStationsByCountry('CA', 15, signal),
    RadioService.getStationsByCountry('TR', 15, signal),
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

const fetchMood = (mood: string, countryCode?: string): StationFetcher => async signal => {
  const tags = getMoodTags(mood).slice(0, countryCode ? MOOD_TAG_COUNT_IN_COUNTRY : MOOD_TAG_COUNT);
  // One unavailable tag shouldn't empty the whole mood.
  const results = await Promise.allSettled(tags.map(tag => RadioService.getStationsByTag(tag, 20, countryCode, signal)));
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
  /** ISO 3166-1 alpha-2 code, or '' for all countries. */
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

  const handleCountryFilter = (code: string) => {
    // With a mood showing, the country narrows (or widens) that mood.
    if (activeMood && activeTab === 'search') {
      setSelectedCountry(code);
      loadStations(fetchMood(activeMood, code || undefined));
      return;
    }
    if (!code) {
      showTrending();
      return;
    }
    setSelectedCountry(code);
    setActiveTab('search');
    setActiveMood(null);
    loadStations(signal => RadioService.getStationsByCountry(code, 50, signal));
  };

  const selectTab = (tab: Tab) => {
    if (tab === 'trending') showTrending();
    else if (tab === 'most') showMostPlayed(playPeriod);
    else {
      setActiveTab(tab);
      if (tab === 'favorites') setActiveMood(null);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  const tabs: NavItem<Tab>[] = [
    { id: 'trending', label: 'Trending', icon: <TrendingUp size={20} /> },
    { id: 'most', label: 'Most Played', icon: <BarChart3 size={20} /> },
    { id: 'favorites', label: 'Favorites', icon: <Heart size={20} /> },
    { id: 'search', label: 'Discover', icon: <Compass size={20} /> },
  ];
  const moodLabel = MOODS.find(m => m.id === activeMood)?.label;
  // Heading above the list on small screens, where the tabs are in the bottom bar.
  const sectionTitle = activeTab === 'search'
    ? moodLabel
      ? `${moodLabel}${selectedCountry ? ` · ${countryName(selectedCountry)}` : ''}`
      : selectedCountry ? countryName(selectedCountry) : 'Discover'
    : tabs.find(t => t.id === activeTab)?.label ?? '';

  return (
    <div
      className={`min-h-screen relative flex flex-col pt-3 lg:pt-6 px-3 sm:px-4 overflow-x-clip text-slate-100 lg:pb-6 ${
        current ? 'pb-[calc(8rem+env(safe-area-inset-bottom))]' : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="atmosphere" />

      {/* Header */}
      <header className="flex justify-between items-center gap-3 mb-3 lg:mb-10 lg:px-2 max-w-[1480px] mx-auto w-full">
        <div className="flex items-center gap-2.5 lg:gap-3 min-w-0">
          <div className="w-8 h-8 lg:w-10 lg:h-10 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.4)] shrink-0">
            <Radio size={20} className="text-black lg:hidden" />
            <Radio size={24} className="text-black hidden lg:block" />
          </div>
          <h1 className="text-lg lg:text-xl font-black tracking-tight text-white italic truncate">GUZEL<span className="text-accent not-italic">RADIO</span></h1>
        </div>
        <div className="lg:hidden">
          <CountryPicker value={selectedCountry} onChange={handleCountryFilter} compact />
        </div>
      </header>

      <div className="max-w-[1480px] mx-auto w-full flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8 lg:items-start">
      <main className="w-full flex flex-col min-w-0">
        {/* Search */}
        <div className="relative mb-3 lg:mb-8 group">
          <form onSubmit={handleSearch} role="search" className="relative z-10 w-full">
            <input
              type="search"
              aria-label="Search stations"
              placeholder="Search 50,000+ stations"
              enterKeyHint="search"
              // 16px on phones so iOS doesn't zoom into the field.
              className="w-full h-12 lg:h-16 bg-white/5 border border-white/5 rounded-xl lg:rounded-2xl pl-11 pr-4 lg:px-14 focus:outline-none focus:border-accent/40 focus:bg-white/8 transition-all placeholder:text-slate-600 text-base lg:text-sm font-medium"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="absolute left-3.5 lg:left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-accent transition-colors w-5 h-5 lg:w-[22px] lg:h-[22px]" />
          </form>
          <div className="absolute inset-0 bg-accent/5 blur-3xl opacity-0 transition-opacity group-focus-within:opacity-100" />
        </div>

        {/* Moods */}
        <div className="mb-4 lg:mb-10">
          <div className="flex items-center gap-2 mb-2 lg:mb-4 px-1">
            <Sparkles size={12} className="text-accent" />
            <h2 className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Moods</h2>
          </div>
          {/* Scrolls edge to edge on phones */}
          <div className="flex gap-2 lg:gap-4 overflow-x-auto no-scrollbar snap-x -mx-3 px-3 sm:mx-0 sm:px-0">
            {MOODS.map(mood => {
              const isActive = activeMood === mood.id;
              const isLoadingMood = isActive && isLoading;
              return (
                <button
                  key={mood.id}
                  onClick={() => handleMoodSelect(mood.id)}
                  aria-pressed={isActive}
                  className={`snap-start flex items-center gap-2 lg:gap-3 h-10 lg:h-12 px-4 lg:px-6 rounded-full lg:rounded-2xl transition-all border shrink-0 ${
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

        {/* Tabs & country (large screens; phones use the bottom bar and header) */}
        <div className="hidden lg:flex items-center justify-between gap-4 mb-6">
          <div className="flex gap-3" role="tablist" aria-label="Sections">
            {tabs.map(tab => (
              <TabButton
                key={tab.id}
                active={activeTab === tab.id}
                onClick={() => selectTab(tab.id)}
                icon={tab.icon}
                label={tab.id === 'search' ? 'Discovery' : tab.label}
              />
            ))}
          </div>
          <CountryPicker value={selectedCountry} onChange={handleCountryFilter} />
        </div>

        <h2 className="lg:hidden text-base font-bold text-white mb-2 px-0.5 truncate">{sectionTitle}</h2>

        {activeTab === 'most' && (
          <div className="flex items-center gap-2 mb-3 lg:mb-6 lg:-mt-2 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0" role="group" aria-label="Most played period">
            {PLAY_PERIODS.map(period => (
              <button
                key={period.id}
                onClick={() => showMostPlayed(period.id)}
                aria-pressed={playPeriod === period.id}
                className={`shrink-0 h-9 px-4 rounded-full text-xs font-bold uppercase tracking-wider border transition-colors ${
                  playPeriod === period.id
                    ? 'bg-accent/10 border-accent/40 text-accent'
                    : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'
                }`}
              >
                {period.label}
              </button>
            ))}
            <span className="hidden sm:inline shrink-0 ml-1 text-[10px] text-slate-600 uppercase tracking-widest">By Guzel Radio listeners</span>
          </div>
        )}

        {/* Station List */}
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2 sm:gap-3 lg:gap-5 lg:pr-1" aria-busy={showListLoading}>
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
              title={activeTab === 'favorites' ? 'No favorites yet' : activeTab === 'most' ? 'No plays yet' : 'Aura silence'}
              message={activeTab === 'favorites'
                ? 'Tap the heart on any station to save it here.'
                : activeTab === 'most'
                  ? `Nothing has been played ${PLAY_PERIODS.find(p => p.id === playPeriod)?.label.toLowerCase() ?? ''} yet. Start listening and the most played stations will show up here.`
                : moodLabel && selectedCountry
                  ? `No ${moodLabel} stations found in ${countryName(selectedCountry)}. Try another mood or country.`
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

      {/* Mini player (below lg), above the tab bar; tap to open Now Playing */}
      <AnimatePresence>
        {current && (
          <motion.footer
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="lg:hidden fixed inset-x-2 z-40 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] h-16 rounded-2xl bg-[#18181b]/95 backdrop-blur-xl border border-white/10 pl-2 pr-2 flex items-center gap-3 shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
          >
            <button
              onClick={() => setSheetOpen(true)}
              aria-label="Open now playing"
              aria-haspopup="dialog"
              className="flex-1 min-w-0 h-full flex items-center gap-3 text-left"
            >
              <div className="w-12 h-12 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shrink-0">
                <img
                  src={stationArtwork(current)}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => fallbackToInitials(e, current.name)}
                />
              </div>
              <div className="min-w-0 flex-1" aria-live="polite">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-sm text-white truncate">{current.name}</h4>
                  <Equalizer analyser={null} active={player.isPlaying && !player.isBuffering && !player.error} bars={4} className="h-3 w-4 shrink-0" />
                </div>
                <p className={`text-xs truncate ${player.error ? 'text-red-300/80' : 'text-slate-400'}`}>
                  {player.error
                    ? 'Unavailable'
                    : player.isBuffering
                      ? 'Connecting…'
                      : track
                        ? `${track.artist ? `${track.artist} – ` : ''}${track.title}`
                        : [current.codec, current.bitrate > 0 ? `${current.bitrate} kbps` : null].filter(Boolean).join(' · ') || 'Live'}
                </p>
              </div>
            </button>
            <button
              onClick={player.togglePlay}
              aria-label={player.isPlaying ? 'Pause' : 'Play'}
              className="w-11 h-11 bg-white text-black rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
            >
              {player.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
            </button>
          </motion.footer>
        )}
      </AnimatePresence>

      <BottomNav items={tabs} active={activeTab} onSelect={selectTab} />

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
            className="lg:hidden fixed inset-0 z-[60] bg-[#050505] overflow-y-auto px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
          >
            <div className="max-w-md mx-auto">
              <button
                onClick={() => setSheetOpen(false)}
                aria-label="Close now playing"
                autoFocus
                className="mb-2 w-11 h-11 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
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
      className={`group relative p-2 pr-1 sm:p-3 lg:p-5 glass rounded-2xl lg:rounded-[2.5rem] flex items-center gap-2 lg:gap-5 hover:border-white/15 hover:bg-white/[0.04] transition-all duration-300 ${
        isCurrent ? 'border-accent/40 bg-accent/[0.03] ring-1 ring-accent/20' : ''
      }`}
    >
      <button
        onClick={onPlay}
        aria-label={`Play ${station.name}`}
        aria-current={isCurrent || undefined}
        className="flex-1 min-w-0 flex items-center gap-3 lg:gap-5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-xl lg:rounded-2xl"
      >
        <div className="relative w-12 h-12 lg:w-16 lg:h-16 flex-shrink-0">
          <img
            src={stationArtwork(station)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover rounded-xl lg:rounded-2xl bg-slate-900 border border-white/5 shadow-lg shadow-black/40"
            onError={(e) => fallbackToInitials(e, station.name)}
          />
          {isCurrent && isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl lg:rounded-2xl backdrop-blur-[2px]">
              <div className="flex gap-1 items-end h-5">
                <motion.div animate={{ height: [4, 16, 8] }} transition={{ duration: 0.5, repeat: Infinity }} className="w-1 bg-accent rounded-full" />
                <motion.div animate={{ height: [8, 4, 16] }} transition={{ duration: 0.6, repeat: Infinity }} className="w-1 bg-accent rounded-full" />
                <motion.div animate={{ height: [12, 16, 4] }} transition={{ duration: 0.4, repeat: Infinity }} className="w-1 bg-accent rounded-full" />
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold truncate text-[15px] lg:text-[14px] text-slate-100 group-hover:text-accent transition-colors duration-300">{station.name}</h3>
          <div className="flex items-center gap-1.5 mt-0.5 lg:mt-1 text-[11px] lg:text-[10px] text-slate-500 min-w-0">
            {station.countrycode && <Flag code={station.countrycode} className="!w-4 !h-3" />}
            <span className="truncate uppercase tracking-wider font-medium">
              {plays !== undefined
                ? `${plays.toLocaleString()} ${plays === 1 ? 'play' : 'plays'}`
                : [station.countrycode ? null : station.country, primaryTag(station)].filter(Boolean).join(' · ') || 'Live'}
            </span>
          </div>
        </div>
      </button>
      <button
        onClick={onToggleFavorite}
        aria-label={isFavorite ? `Remove ${station.name} from favorites` : `Add ${station.name} to favorites`}
        aria-pressed={isFavorite}
        className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-xl lg:rounded-2xl transition-all ${
          isFavorite ? 'text-accent bg-accent/10' : 'text-slate-600 hover:text-slate-300 hover:bg-white/5'
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
      className="col-span-full py-12 lg:py-24 px-6 text-center border border-white/5 bg-white/[0.02] rounded-2xl lg:rounded-[2.5rem]"
    >
      <div className="w-14 h-14 lg:w-16 lg:h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 lg:mb-6">
        {icon}
      </div>
      <h3 className="text-slate-300 font-bold mb-2 uppercase tracking-widest text-xs">{title}</h3>
      <p className="text-xs text-slate-500 max-w-[260px] mx-auto leading-relaxed">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 lg:mt-6 h-11 px-5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-bold uppercase tracking-widest text-slate-300 transition-colors"
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
      role="tab"
      aria-selected={active}
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
