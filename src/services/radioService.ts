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

  static searchStations(query: string, limit = 50, country?: string, signal?: AbortSignal): Promise<RadioStation[]> {
    return request('stations/search', { ...LIST_DEFAULTS, name: query, country, limit }, signal);
  }

  // `country` is a partial name match (Radio Browser stores names such as
  // "The United Kingdom Of Great Britain And Northern Ireland").
  static getStationsByTag(tag: string, limit = 50, country?: string, signal?: AbortSignal): Promise<RadioStation[]> {
    return request('stations/search', { ...LIST_DEFAULTS, tag, country, limit }, signal);
  }

  static getStationsByCountry(country: string, limit = 50, signal?: AbortSignal): Promise<RadioStation[]> {
    return request(`stations/bycountry/${encodeURIComponent(country)}`, { ...LIST_DEFAULTS, limit }, signal);
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
