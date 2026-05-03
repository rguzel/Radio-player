import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Pause, 
  Search, 
  Radio, 
  Heart, 
  Volume2, 
  Globe, 
  TrendingUp,
  History,
  SkipForward,
  SkipBack,
  User,
  Settings,
  MoreVertical,
  Sparkles,
  Zap,
  Coffee,
  Moon,
  Sun
} from 'lucide-react';
import { RadioStation, PlaybackState } from './types';
import { RadioService } from './services/radioService';
import { GeminiService } from './services/geminiService';

const MOODS = [
  { id: 'focus', label: 'Focus', icon: <Zap size={16} />, color: 'blue' },
  { id: 'chill', label: 'Chill', icon: <Coffee size={16} />, color: 'orange' },
  { id: 'deep', label: 'Night', icon: <Moon size={16} />, color: 'purple' },
  { id: 'energy', label: 'Vibe', icon: <Sun size={16} />, color: 'yellow' },
];

const COUNTRIES = [
  { label: 'Canada', value: 'Canada' },
  { label: 'Türkiye', value: 'Turkey' },
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

export default function App() {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'trending' | 'search' | 'favorites'>('trending');
  const [favorites, setFavorites] = useState<RadioStation[]>([]);
  const [isLoadingMood, setIsLoadingMood] = useState(false);
  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [playback, setPlayback] = useState<PlaybackState>({
    currentStation: null,
    isPlaying: false,
    isBuffering: false,
    volume: 0.8
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize favorites from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('waveform_favorites');
    if (saved) setFavorites(JSON.parse(saved));
    
    // Initial fetch
    fetchTrending();
  }, []);

  const fetchTrending = async () => {
    try {
      // Prioritize Canada and Turkey stations
      const [caData, trData, topData] = await Promise.all([
        RadioService.getStationsByCountry('Canada', 15),
        RadioService.getStationsByCountry('Turkey', 15),
        RadioService.getTopStations(20)
      ]);

      // Merge and remove duplicates based on stationuuid
      const merged = [...caData, ...trData, ...topData];
      const unique = merged.filter((v, i, a) => a.findIndex(t => t.stationuuid === v.stationuuid) === i);
      
      setStations(unique);
    } catch (error) {
      console.error('Failed to fetch stations:', error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      const data = await RadioService.searchStations(searchQuery);
      setStations(data);
      setActiveTab('search');
    } catch (error) {
      console.error('Search failed:', error);
    }
  };

  const handleMoodSelect = async (mood: string) => {
    if (isLoadingMood) return;
    setIsLoadingMood(true);
    setActiveMood(mood);
    try {
      const genres = await GeminiService.suggestGenres(mood);
      // Search for the first suggested genre to show results quickly
      const data = await RadioService.getStationsByTag(genres[0], 30);
      setStations(data);
      setActiveTab('search');
    } catch (error) {
      console.error('Mood discovery failed:', error);
    } finally {
      setIsLoadingMood(false);
    }
  };

  const handleCountryFilter = async (country: string) => {
    setSelectedCountry(country);
    if (!country) {
      setActiveTab('trending');
      setActiveMood(null);
      fetchTrending();
      return;
    }
    try {
      const data = await RadioService.getStationsByCountry(country, 50);
      setStations(data);
      setActiveTab('search');
    } catch (error) {
      console.error('Country filter failed:', error);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !playback.currentStation) return;
    
    if (playback.isPlaying) {
      audioRef.current.pause();
    } else {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (e.name !== 'AbortError') console.error("Playback error", e);
        });
      }
    }
    setPlayback(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  const playStation = async (station: RadioStation) => {
    if (audioRef.current) {
      try {
        // Reset audio state
        audioRef.current.pause();
        audioRef.current.src = station.url_resolved || station.url;
        audioRef.current.load(); // Force reset internal state
        
        // Use the promise returned by play() to handle interruptions
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => {
            if (e.name === 'AbortError') {
              console.log("Playback was aborted (likely by a new selection or pause)");
            } else {
              console.error("Playback error (likely CORS or invalid URL):", e);
            }
          });
        }
      } catch (err) {
        console.error("Critical playback error:", err);
      }
    }
    setPlayback(prev => ({
      ...prev,
      currentStation: station,
      isPlaying: true,
      isBuffering: true
    }));

    // Update Media Session API for Android Auto / Lock Screen
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: 'Guzel Radio',
        album: station.country + ' • ' + (station.tags ? station.tags.split(',')[0].toUpperCase() : 'Live'),
        artwork: [
          { src: station.favicon || 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=512&h=512&fit=crop', sizes: '512x512', type: 'image/png' },
          { src: `https://ui-avatars.com/api/?name=${encodeURIComponent(station.name)}&background=333&color=fff&size=512`, sizes: '512x512', type: 'image/png' }
        ]
      });

      navigator.mediaSession.playbackState = 'playing';

      navigator.mediaSession.setActionHandler('play', () => {
        const playPromise = audioRef.current?.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => {
             if (e.name !== 'AbortError') console.error("MediaSession Play error", e);
          });
        }
        setPlayback(prev => ({ ...prev, isPlaying: true }));
        navigator.mediaSession.playbackState = 'playing';
      });
      
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current?.pause();
        setPlayback(prev => ({ ...prev, isPlaying: false }));
        navigator.mediaSession.playbackState = 'paused';
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        const currentList = activeTab === 'favorites' ? favorites : stations;
        const index = currentList.findIndex(s => s.stationuuid === station.stationuuid);
        if (index !== -1 && index < currentList.length - 1) {
          playStation(currentList[index + 1]);
        }
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        const currentList = activeTab === 'favorites' ? favorites : stations;
        const index = currentList.findIndex(s => s.stationuuid === station.stationuuid);
        if (index > 0) {
          playStation(currentList[index - 1]);
        }
      });
    }
  };

  const toggleFavorite = (station: RadioStation) => {
    const isFav = favorites.some(s => s.stationuuid === station.stationuuid);
    let newFavs;
    if (isFav) {
      newFavs = favorites.filter(s => s.stationuuid !== station.stationuuid);
    } else {
      newFavs = [...favorites, station];
    }
    setFavorites(newFavs);
    localStorage.setItem('waveform_favorites', JSON.stringify(newFavs));
  };

  return (
    <div className="min-h-screen relative flex flex-col pt-6 pb-24 px-4 overflow-hidden text-slate-100">
      <div className="atmosphere" />
      
      <audio 
        ref={audioRef} 
        onWaiting={() => setPlayback(p => ({ ...p, isBuffering: true }))}
        onPlaying={() => setPlayback(p => ({ ...p, isBuffering: false }))}
        onPause={() => setPlayback(p => ({ ...p, isPlaying: false }))}
        onPlay={() => setPlayback(p => ({ ...p, isPlaying: true }))}
      />

      {/* Header */}
      <header className="flex justify-between items-center mb-10 px-2 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.4)]">
            <Radio size={24} className="text-black" />
          </div>
          <h1 className="text-xl font-black tracking-tight text-white italic">GUZEL<span className="text-accent not-italic">RADIO</span></h1>
        </div>
        
        <div className="flex items-center gap-6">
          <nav className="hidden md:flex gap-8 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
            <button className={`${activeTab === 'search' ? 'text-accent' : 'hover:text-white'} transition-colors`} onClick={() => setActiveTab('search')}>Explore</button>
            <button className={`${activeTab === 'favorites' ? 'text-accent' : 'hover:text-white'} transition-colors`} onClick={() => setActiveTab('favorites')}>Favorites</button>
            <button className="hover:text-white transition-colors">Global</button>
          </nav>
          <div className="hidden md:block h-6 w-[1px] bg-white/10 mx-2"></div>
          <button className="flex items-center gap-2 bg-slate-800/40 hover:bg-slate-700/60 px-4 py-2 rounded-full border border-white/5 transition-all group active:scale-95">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse group-hover:bg-blue-300"></div>
            <span className="text-[10px] font-black tracking-[0.1em] text-slate-300">AUTO CONNECTED</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full flex-1 flex flex-col min-h-0">
        {/* Main Search Bar */}
        <div className="relative mb-8 group">
          <form onSubmit={handleSearch} className="relative z-10 w-full">
            <input 
              type="text" 
              placeholder="Search 50,000+ stations worldwide..."
              className="w-full h-16 bg-white/5 border border-white/5 rounded-2xl px-14 focus:outline-none focus:border-accent/40 focus:bg-white/8 transition-all placeholder:text-slate-600 text-sm font-medium"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-accent transition-colors" size={22} />
          </form>
          <div className="absolute inset-0 bg-accent/5 blur-3xl opacity-0 transition-opacity group-focus-within:opacity-100" />
        </div>

        {/* AI Mood Discovery */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-4 px-1">
            <Sparkles size={14} className="text-accent" />
            <h2 className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em]">Curation AI</h2>
          </div>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
            {MOODS.map(mood => (
              <button
                key={mood.id}
                onClick={() => handleMoodSelect(mood.id)}
                disabled={isLoadingMood}
                className={`flex items-center gap-3 px-6 py-3 rounded-2xl transition-all border shrink-0 ${
                  activeMood === mood.id 
                    ? 'bg-accent/10 border-accent/40 text-accent shadow-[0_0_20px_rgba(245,158,11,0.1)]' 
                    : 'bg-white/5 border-white/5 text-slate-400 hover:border-white/10 hover:text-slate-200'
                } ${isLoadingMood && activeMood === mood.id ? 'animate-pulse' : ''}`}
              >
                {isLoadingMood && activeMood === mood.id ? (
                  <div className="w-4 h-4 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
                ) : mood.icon}
                <span className="text-xs font-bold tracking-wider uppercase">{mood.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tabs & Filters */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex gap-3 overflow-x-auto no-scrollbar py-1">
            <TabButton
              active={activeTab === 'trending'}
              onClick={() => { setActiveTab('trending'); setActiveMood(null); setSelectedCountry(''); fetchTrending(); }}
              icon={<TrendingUp size={16} />}
              label="Trending"
            />
            <TabButton
              active={activeTab === 'favorites'}
              onClick={() => { setActiveTab('favorites'); setActiveMood(null); setSelectedCountry(''); }}
              icon={<Heart size={16} />}
              label="Favorites"
            />
            <TabButton
              active={activeTab === 'search'}
              onClick={() => { setActiveTab('search'); setActiveMood(null); setSelectedCountry(''); }}
              icon={<Globe size={16} />}
              label="Discovery"
            />
          </div>
          <select
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 overflow-y-auto pr-1 thin-scroll pb-32">
          <AnimatePresence mode="popLayout">
            {((activeTab === 'favorites' ? favorites : stations).length === 0 && !isLoadingMood) ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="col-span-full py-24 text-center border border-white/5 bg-white/[0.02] rounded-[2.5rem]"
              >
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Radio size={32} className="text-slate-700" />
                </div>
                <h3 className="text-slate-300 font-bold mb-2 uppercase tracking-widest text-xs">AURA SILENCE</h3>
                <p className="text-xs text-slate-500 max-w-[200px] mx-auto leading-relaxed">No stations match your current frequency. Try another search.</p>
              </motion.div>
            ) : (activeTab === 'favorites' ? favorites : stations).map((station) => (
              <motion.div
                layout
                key={station.stationuuid}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`group relative p-5 glass rounded-[2.5rem] flex items-center gap-5 cursor-pointer hover:border-white/15 hover:bg-white/[0.04] transition-all duration-300 ${
                  playback.currentStation?.stationuuid === station.stationuuid ? 'border-accent/40 bg-accent/[0.03] ring-1 ring-accent/20' : ''
                }`}
                onClick={() => playStation(station)}
              >
                <div className="relative w-16 h-16 flex-shrink-0">
                  <img 
                    src={station.favicon || `https://ui-avatars.com/api/?name=${encodeURIComponent(station.name)}&background=333&color=fff&size=128`} 
                    alt={station.name}
                    className="w-full h-full object-cover rounded-2xl bg-slate-900 border border-white/5 shadow-lg shadow-black/40"
                    onError={(e) => (e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(station.name)}&background=111&color=fff&size=128`)}
                  />
                  {playback.currentStation?.stationuuid === station.stationuuid && playback.isPlaying && (
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
                      {station.tags ? station.tags.split(',')[0] : 'broadcast'}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(station); }}
                  className={`p-3 rounded-2xl transition-all ${
                    favorites.some(s => s.stationuuid === station.stationuuid) 
                      ? 'text-accent bg-accent/10' 
                      : 'text-slate-700 hover:text-slate-300 hover:bg-white/5'
                  }`}
                >
                  <Heart size={18} fill={favorites.some(s => s.stationuuid === station.stationuuid) ? 'currentColor' : 'none'} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer / Large Player Controls */}
      <AnimatePresence>
        {playback.currentStation && (
          <motion.footer
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 200, opacity: 0 }}
            className="fixed bottom-0 left-0 right-0 z-50 h-28 bg-black/85 backdrop-blur-3xl border-t border-white/10 px-6 sm:px-10 flex items-center justify-between shadow-[0_-20px_60px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center gap-5 sm:w-1/3 min-w-0">
              <div className="hidden sm:block w-16 h-16 bg-slate-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl shrink-0 group relative cursor-pointer">
                <img 
                  src={playback.currentStation.favicon || `https://ui-avatars.com/api/?name=${encodeURIComponent(playback.currentStation.name)}&background=333&color=fff`} 
                  alt="" 
                  className="w-full h-full object-cover transition-transform group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-accent/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-2 h-2 rounded-full ${playback.isBuffering ? 'bg-amber-400 animate-pulse' : 'bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.5)]'}`} />
                  <span className="text-[10px] font-black tracking-[0.2em] text-slate-500 uppercase">
                    {playback.isBuffering ? 'Syncing...' : 'Live Stream'}
                  </span>
                </div>
                <h4 className="font-bold text-base text-white truncate max-w-[200px]">{playback.currentStation.name}</h4>
                <div className="flex items-center gap-3">
                   <p className="text-[10px] text-accent font-bold uppercase tracking-widest">{playback.currentStation.codec}</p>
                   <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                   <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                    {playback.currentStation.bitrate > 0 ? `${playback.currentStation.bitrate}kbps` : 'High Definition'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 lg:gap-12">
              <button className="hidden sm:block p-3 text-slate-500 hover:text-white transition-colors active:scale-90">
                <SkipBack size={24} />
              </button>
              <button 
                onClick={togglePlay}
                className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:scale-105 active:scale-95 transition-all glow-accent relative z-10"
              >
                {playback.isPlaying && !playback.isBuffering ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
              </button>
              <button className="hidden sm:block p-3 text-slate-500 hover:text-white transition-colors active:scale-90">
                <SkipForward size={24} />
              </button>
            </div>

            <div className="hidden lg:flex w-1/3 justify-end items-center gap-8">
              <div className="flex items-center gap-4">
                <Volume2 size={18} className="text-slate-500" />
                <div className="w-28 h-1 bg-slate-800 rounded-full relative group cursor-pointer overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-accent rounded-full shadow-[0_0_10px_rgba(245,158,11,0.5)]" style={{ width: '85%' }} />
                </div>
              </div>
              <div className="h-10 w-[1px] bg-white/5 mx-2"></div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Signal</span>
                <div className="flex items-end gap-0.5 h-4">
                  <div className="w-1 bg-green-500 h-2 rounded-full"></div>
                  <div className="w-1 bg-green-500 h-3 rounded-full"></div>
                  <div className="w-1 bg-green-500 h-4 rounded-full"></div>
                  <div className="w-1 bg-green-500/20 h-2 rounded-full"></div>
                </div>
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
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

