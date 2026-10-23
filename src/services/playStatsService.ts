// Guzel Radio's own play counts (server/nowplaying, /api/plays).

export type PlayPeriod = 'day' | 'week' | 'all';

export interface StationPlays {
  uuid: string;
  plays: number;
}

export class PlayStatsService {
  /** Records that a station started playing. Fire-and-forget. */
  static async recordPlay(uuid: string): Promise<void> {
    await fetch(`/api/plays?uuid=${encodeURIComponent(uuid)}`, { method: 'POST', keepalive: true });
  }

  static async getMostPlayed(period: PlayPeriod, limit = 50, signal?: AbortSignal): Promise<StationPlays[]> {
    const response = await fetch(`/api/plays/top?period=${period}&limit=${limit}`, { signal });
    // Without the backend, the SPA fallback answers with index.html.
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`Play stats unavailable (HTTP ${response.status})`);
    }
    const data: { stations?: StationPlays[] } = await response.json();
    return data.stations ?? [];
  }
}
