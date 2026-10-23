import { useEffect, useRef, useState } from 'react';
import { RadioStation } from '../types';

const POLL_INTERVAL_MS = 20_000;

export interface TrackInfo {
  artist: string | null;
  title: string;
}

/**
 * Polls the now-playing endpoint (server/nowplaying) for the current station's
 * track while it's playing and the tab is visible. Returns null when the
 * station sends no track info or the endpoint isn't deployed.
 */
export function useNowPlaying(station: RadioStation | null, isPlaying: boolean): TrackInfo | null {
  const [track, setTrack] = useState<(TrackInfo & { uuid: string }) | null>(null);
  // Set once the endpoint turns out to be missing, so we stop asking.
  const unavailableRef = useRef(false);
  const uuid = station?.stationuuid ?? null;

  useEffect(() => {
    if (!uuid || !isPlaying || unavailableRef.current) return;

    const controller = new AbortController();
    let timer: number | undefined;
    let inFlight = false;

    const poll = async () => {
      if (!document.hidden) {
        inFlight = true;
        try {
          const response = await fetch(`/api/nowplaying?uuid=${encodeURIComponent(uuid)}`, { signal: controller.signal });
          // Without the backend, the SPA fallback answers with index.html.
          if (!response.headers.get('content-type')?.includes('application/json')) {
            unavailableRef.current = true;
            return;
          }
          if (response.status === 404) return; // station unknown to the directory
          if (response.ok) {
            const data: { artist?: string | null; title?: string | null } = await response.json();
            setTrack(data.title ? { uuid, artist: data.artist ?? null, title: data.title } : null);
          }
        } catch {
          if (controller.signal.aborted) return;
          // Network blip: keep the last known track and try again later.
        } finally {
          inFlight = false;
        }
      }
      timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    };

    // Refresh straight away when the tab comes back into view.
    const onVisible = () => {
      if (document.hidden || inFlight) return;
      window.clearTimeout(timer);
      poll();
    };

    poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [uuid, isPlaying]);

  return track && track.uuid === uuid ? { artist: track.artist, title: track.title } : null;
}
