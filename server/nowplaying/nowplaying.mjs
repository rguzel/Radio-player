import { readStreamTitle, splitTrack } from './icy.mjs';

const RADIO_BROWSER_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
];

/** Looks up a station's stream URL on Radio Browser, trying each mirror. */
export async function lookupStreamUrl(uuid) {
  let lastError;
  for (const server of RADIO_BROWSER_SERVERS) {
    try {
      const response = await fetch(`${server}/json/stations/byuuid?uuids=${encodeURIComponent(uuid)}`, {
        headers: { 'User-Agent': 'GuzelRadio-NowPlaying/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Radio Browser responded with HTTP ${response.status}`);
      const [station] = await response.json();
      return station ? station.url_resolved || station.url || null : null;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Now-playing lookups with a short cache, so many listeners on one station
 * cost one upstream connection, plus a cap on concurrent stream connections.
 */
export function createNowPlayingService({
  resolveStreamUrl = lookupStreamUrl,
  readTitle = readStreamTitle,
  ttlMs = 15_000,
  stationTtlMs = 60 * 60_000,
  maxConcurrent = 20,
  maxEntries = 2000,
  now = () => Date.now(),
} = {}) {
  const results = new Map();    // uuid -> { value, expires }
  const streamUrls = new Map(); // uuid -> { url, expires }
  const inFlight = new Map();   // uuid -> Promise
  let active = 0;

  const remember = (map, key, entry) => {
    if (map.size >= maxEntries) map.delete(map.keys().next().value);
    map.set(key, entry);
  };

  async function streamUrlFor(uuid) {
    const cached = streamUrls.get(uuid);
    if (cached && cached.expires > now()) return cached.url;
    const url = await resolveStreamUrl(uuid);
    if (url) remember(streamUrls, uuid, { url, expires: now() + stationTtlMs });
    return url;
  }

  async function fetchNowPlaying(uuid) {
    const url = await streamUrlFor(uuid);
    if (!url) return null;

    let streamTitle = null;
    if (active < maxConcurrent) {
      active++;
      try {
        streamTitle = await readTitle(url);
      } catch {
        // Offline, blocked or non-ICY stream: report "no track info".
      } finally {
        active--;
      }
    }
    return { uuid, ...splitTrack(streamTitle), raw: streamTitle, fetchedAt: new Date(now()).toISOString() };
  }

  /** Resolves with the track info, or null when the station doesn't exist. */
  async function get(uuid) {
    const cached = results.get(uuid);
    if (cached && cached.expires > now()) return cached.value;

    let pending = inFlight.get(uuid);
    if (!pending) {
      pending = fetchNowPlaying(uuid)
        .then(value => {
          if (value) remember(results, uuid, { value, expires: now() + ttlMs });
          return value;
        })
        .finally(() => inFlight.delete(uuid));
      inFlight.set(uuid, pending);
    }
    return pending;
  }

  return { get };
}
