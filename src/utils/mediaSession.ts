import { RadioStation } from '../types';
import type { TrackInfo } from '../hooks/useNowPlaying';
import { primaryTag, stationArtwork } from './artwork';

const APP_TITLE = 'Guzel Radio';

/** Updates lock-screen / OS media metadata and the tab title. */
export function updateMediaSession(station: RadioStation | null, track: TrackInfo | null) {
  if (!station) {
    document.title = APP_TITLE;
    return;
  }

  document.title = track
    ? `${track.artist ? `${track.artist} – ` : ''}${track.title} · ${station.name}`
    : `${station.name} · ${APP_TITLE}`;

  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track?.title ?? station.name,
    artist: track ? (track.artist ?? station.name) : APP_TITLE,
    album: track
      ? station.name
      : [station.country, primaryTag(station)?.toUpperCase() ?? 'Live'].filter(Boolean).join(' • '),
    artwork: [{ src: stationArtwork(station), sizes: '512x512' }],
  });
}
