export interface RadioStation {
  changeid: string;
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  language: string;
  votes: number;
  clickcount: number;
  codec: string;
  bitrate: number;
}

export interface PlaybackState {
  currentStation: RadioStation | null;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
}
