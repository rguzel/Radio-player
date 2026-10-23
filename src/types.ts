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
  /** ISO 3166-1 alpha-2, e.g. "CA" (may be empty). */
  countrycode?: string;
  language: string;
  votes: number;
  clickcount: number;
  codec: string;
  bitrate: number;
}
