import { RadioStation } from '../types';

// Radio Browser runs several mirrors; if one is down, fall through to the next
// and remember whichever answered so later requests go there first.
const SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
];
let preferredServer = 0;

type QueryParams = Record<string, string | number | boolean | undefined>;

// Applied to every station list: skip stations Radio Browser has flagged as
// broken and put the most-played ones first.
const LIST_DEFAULTS: QueryParams = { hidebroken: true, order: 'clickcount', reverse: true };

async function request<T>(path: string, params: QueryParams, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < SERVERS.length; attempt++) {
    const index = (preferredServer + attempt) % SERVERS.length;
    try {
      const response = await fetch(`${SERVERS[index]}/json/${path}?${query}`, { signal });
      if (!response.ok) throw new Error(`Radio Browser responded with HTTP ${response.status}`);
      const data = (await response.json()) as T;
      preferredServer = index;
      return data;
    } catch (error) {
      // A cancelled request should stop here, not try the other mirrors.
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export class RadioService {
  static getTopStations(limit = 20, signal?: AbortSignal): Promise<RadioStation[]> {
    return request(`stations/topclick/${limit}`, { hidebroken: true }, signal);
  }

  // `countryCode` is an ISO 3166-1 alpha-2 code (e.g. "CA"), matched exactly.
  static searchStations(query: string, limit = 50, countryCode?: string, signal?: AbortSignal): Promise<RadioStation[]> {
    return request('stations/search', { ...LIST_DEFAULTS, name: query, countrycode: countryCode, limit }, signal);
  }

  static getStationsByTag(tag: string, limit = 50, countryCode?: string, signal?: AbortSignal): Promise<RadioStation[]> {
    return request('stations/search', { ...LIST_DEFAULTS, tag, countrycode: countryCode, limit }, signal);
  }

  static getStationsByCountry(countryCode: string, limit = 50, signal?: AbortSignal): Promise<RadioStation[]> {
    return request(`stations/bycountrycodeexact/${encodeURIComponent(countryCode)}`, { ...LIST_DEFAULTS, limit }, signal);
  }

  /** Countries with at least one working station. */
  static getCountries(signal?: AbortSignal): Promise<{ name: string; iso_3166_1: string; stationcount: number }[]> {
    return request('countries', { hidebroken: true }, signal);
  }

  static getStationsByUuids(uuids: string[], signal?: AbortSignal): Promise<RadioStation[]> {
    if (uuids.length === 0) return Promise.resolve([]);
    return request('stations/byuuid', { uuids: uuids.join(',') }, signal);
  }

  /**
   * Tells Radio Browser a listener started this station. Feeds its click
   * counts and "trending" ranking; Radio Browser asks apps to send this on
   * every play and counts at most one click per IP per station per day.
   */
  static async reportClick(uuid: string): Promise<void> {
    await request(`url/${encodeURIComponent(uuid)}`, {});
  }

  /** Votes for a station. Radio Browser allows one vote per IP per station every 10 minutes. */
  static vote(uuid: string): Promise<{ ok: boolean; message: string }> {
    return request(`vote/${encodeURIComponent(uuid)}`, {});
  }
}

/** Removes repeated stations (same uuid), keeping the first occurrence. */
export function uniqueStations(stations: RadioStation[]): RadioStation[] {
  const seen = new Set<string>();
  return stations.filter(station => {
    if (seen.has(station.stationuuid)) return false;
    seen.add(station.stationuuid);
    return true;
  });
}
