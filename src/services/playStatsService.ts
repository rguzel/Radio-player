// Guzel Radio's own play counts (server/nowplaying, /api/plays).

export type PlayPeriod = 'day' | 'week' | 'all';

export interface StationPlays {
  uuid: string;
  plays: number;
}

/** Plays from one listener country. `country` is ISO 3166 alpha-2, or "XX" when unknown. */
export interface CountryPlays {
  country: string;
  plays: number;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  // Without the backend, the SPA fallback answers with index.html.
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Play stats unavailable (HTTP ${response.status})`);
  }
  return response.json();
}

export class PlayStatsService {
  /** Records that a station started playing. Fire-and-forget. */
  static async recordPlay(uuid: string): Promise<void> {
    await fetch(`/api/plays?uuid=${encodeURIComponent(uuid)}`, { method: 'POST', keepalive: true });
  }

  static async getMostPlayed(period: PlayPeriod, limit = 50, signal?: AbortSignal): Promise<StationPlays[]> {
    const data = await getJson<{ stations?: StationPlays[] }>(`/api/plays/top?period=${period}&limit=${limit}`, signal);
    return data.stations ?? [];
  }

  /** Where listeners are listening from: plays per country, highest first. */
  static async getListenerCountries(period: PlayPeriod, signal?: AbortSignal): Promise<CountryPlays[]> {
    const data = await getJson<{ countries?: CountryPlays[] }>(`/api/plays/countries?period=${period}`, signal);
    return data.countries ?? [];
  }
}
