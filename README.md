# Guzel Radio

A sleek, dark-themed internet radio player with 50,000+ stations worldwide, mood-based discovery, country filtering, and favorites. Live at [radio.recepguzel.com](https://radio.recepguzel.com).

---

## Features

- **Live streaming** — play any of 50,000+ stations from the [Radio Browser](https://www.radio-browser.info/) public API, no account required
- **Search** — search stations by name globally or scoped to a selected country
- **Country filter** — browse by country from the dropdown; Canada and Türkiye are pinned at the top
- **Moods** — four presets (Focus, Chill, Night, Vibe) map to genre tags; the top tags are queried and merged by popularity
- **Most Played** — Today / This week / All time rankings from Guzel Radio's own listeners (see [server/nowplaying](server/nowplaying/README.md))
- **Listeners** — which countries people listen from, for the same periods (country from Cloudflare; only per-country totals are stored)
- **Votes** — vote for a station from the Now Playing panel; plays are also reported to Radio Browser so popular stations rank higher
- **Favorites** — heart any station to save it; persisted in browser `localStorage` (survives page reloads, device-local)
- **Media Session API** — lock screen / OS media controls: play, pause, next, previous station
- **Volume control** — remembered between visits
- **Now Playing panel** — sticky panel on the right on wide screens (a full-screen sheet on mobile, opened from the mini player) showing the current track, station details, genres and website
- **What's on air** — artist and title from the stream's ICY metadata, read by a small server endpoint (see [server/nowplaying](server/nowplaying/README.md)); also shown on the lock screen and in the tab title
- **Graphic equalizer** — real spectrum (Web Audio) on desktop when the station's stream allows CORS; otherwise an animated visualizer
- **Resilient API access** — falls back across Radio Browser mirrors and shows a retry option when the directory is unreachable
- **Animated player bar** — fixed footer with live signal indicator, bitrate, codec, and buffering state

## 📱 Android App

Guzel Radio is also available as a native Android application with premium features:

- **Download APK**: [Latest Release (guzel-radio.apk)](https://github.com/rguzel/Radio-player/releases/latest)
- **Features**: 
    - **Android Auto** support with Spotify-like "Now Playing" UI.
    - **Live RDS/Metadata** (Artist - Song Title) support.
    - **First-run Wizard** to select your preferred country.
    - **Edge-to-Edge** immersive dark-mode UI.
    - **Nano Banana** custom icon.

## ⌚ Wear OS App (Samsung Galaxy Watch & more)

Experience Guzel Radio directly on your wrist with a standalone Wear OS application.

- **Download APK**: [Latest Release (guzel-radio-wear.apk)](https://github.com/rguzel/Radio-player/releases/latest)
- **Standalone Streaming**: Play radio directly from your watch over Wi-Fi or LTE.
- **Rotating Bezel Support**: Adjust volume naturally using the physical bezel on Galaxy Watch Classic models.
- **Media Controls**: Full control over playback and station switching.

### **How to Install on Wear OS**

Since smartwatches lack USB ports, use "Sideloading" via Wi-Fi:

1.  **Enable Developer Mode**: On your watch, go to `Settings > About Watch > Software Info` and tap `Software Version` 7 times.
2.  **Enable Wireless Debugging**: In `Settings > Developer Options`, turn on `ADB Debugging` and `Wireless Debugging`.
3.  **Install via Phone (Easiest)**:
    *   Install the **Bugjaeger** app on your Android phone.
    *   Connect to your watch's IP address (found in Wireless Debugging settings).
    *   Select `guzel-radio-wear.apk` and tap Install.
4.  **Install via PC**:
    ```bash
    adb connect [WATCH_IP]
    adb install guzel-radio-wear.apk
    ```

## Tech Stack

| Layer | Library |
|-------|---------|
| UI framework | React 19 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 4 |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |
| Station data | [radio-browser.info](https://de1.api.radio-browser.info) public API |

The SPA is fully static. The only backend piece is the optional now-playing endpoint in `server/nowplaying` (plain Node, no dependencies); without it, track info is simply hidden.

## Project Structure

```
src/
├── App.tsx                  # Main component — layout, station list, player bar
├── main.tsx                 # React entry point
├── index.css                # Global styles / Tailwind base
├── types.ts                 # RadioStation interface
├── components/
│   ├── NowPlayingPanel.tsx  # Track, controls, equalizer and station details
│   ├── ListenerCountries.tsx # Listeners tab: plays per country
│   ├── Equalizer.tsx        # Canvas equalizer (real spectrum or simulated)
│   └── StationVotes.tsx     # Vote count + vote button
├── hooks/
│   ├── useRadioPlayer.ts    # Playback engine, skip queue, volume, Media Session
│   ├── useNowPlaying.ts     # Polls /api/nowplaying for the current track
│   ├── useListenerCountries.ts # Loads /api/plays/countries for the Listeners tab
│   └── useFavorites.ts      # Favorites persisted to localStorage
├── services/
│   ├── radioService.ts      # radio-browser.info API calls with mirror failover, clicks, votes
│   ├── playStatsService.ts  # /api/plays: record plays, most played, listener countries
│   └── moodService.ts       # Mood → genre tag mapping (static, no external API call)
└── utils/
    ├── artwork.ts           # Station artwork with local initials fallback
    └── mediaSession.ts      # Lock-screen metadata and tab title

server/nowplaying/           # /api/nowplaying — ICY metadata endpoint (Node 20+, no deps)
```

## Run Locally

**Prerequisites:** Node.js 18+

```bash
npm ci
npm run dev        # starts on http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build → dist/
npm run lint       # TypeScript type check
npm run preview    # preview production build locally
```

No API keys needed — the radio-browser.info API is public and free.

In dev, `/api` is proxied to the live site so track info works. To use a local
now-playing server instead: `cd server/nowplaying && npm start`, then run
`API_PROXY_TARGET=http://127.0.0.1:3100 npm run dev`.

## Deployment

The live site is hosted on a self-managed server behind nginx with Let's Encrypt TLS.

Push to `main` → GitHub webhook fires → `deploy.sh` on the server clones the repo, builds inside a `node:20-alpine` Docker container, and rsyncs the output to the nginx document root. Manual deploy:

```bash
bash ~/radio/deploy.sh
```

## API Reference

All station data comes from the [Radio Browser API](https://api.radio-browser.info/):

| Endpoint | Purpose |
|----------|---------|
| `/json/stations/topclick/{n}` | Trending stations |
| `/json/stations/byname/{query}?country=X` | Name search with optional country filter |
| `/json/stations/bycountry/{country}` | All stations in a country |
| `/json/stations/bytag/{tag}` | Stations by genre tag (used by mood curation) |

## Favorites

Stored in browser `localStorage` under the key `waveform_favorites` as a JSON array of station objects. Device-local — clearing browser storage removes them.
