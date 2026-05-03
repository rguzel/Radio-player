# Guzel Radio

A sleek, dark-themed internet radio player with 50,000+ stations worldwide, mood-based discovery, country filtering, and favorites. Live at [radio.recepguzel.com](https://radio.recepguzel.com).

---

## Features

- **Live streaming** — play any of 50,000+ stations from the [Radio Browser](https://www.radio-browser.info/) public API, no account required
- **Search** — search stations by name globally or scoped to a selected country
- **Country filter** — browse by country from the dropdown; Canada and Türkiye are pinned at the top
- **Mood / AI curation** — four mood presets (Focus, Chill, Night, Vibe) map to genre tags and surface matching stations
- **Favorites** — heart any station to save it; persisted in browser `localStorage` (survives page reloads, device-local)
- **Media Session API** — lock screen / Android Auto controls: play, pause, next, previous track
- **Animated player bar** — fixed footer with live signal indicator, bitrate, codec, and buffering state

## Tech Stack

| Layer | Library |
|-------|---------|
| UI framework | React 19 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 4 |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |
| Station data | [radio-browser.info](https://de1.api.radio-browser.info) public API |

No backend, no database — fully static SPA.

## Project Structure

```
src/
├── App.tsx                  # Main component — all UI, state, playback logic
├── main.tsx                 # React entry point
├── index.css                # Global styles / Tailwind base
├── types.ts                 # RadioStation and PlaybackState interfaces
└── services/
    ├── radioService.ts      # radio-browser.info API calls
    └── geminiService.ts     # Mood → genre mapping (static, no external API call)
```

## Run Locally

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev        # starts on http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build → dist/
npm run lint       # TypeScript type check
npm run preview    # preview production build locally
```

No API keys needed — the radio-browser.info API is public and free.

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
