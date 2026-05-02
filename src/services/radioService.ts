import { RadioStation } from '../types';

const BASE_URL = 'https://de1.api.radio-browser.info/json';

export class RadioService {
  static async getTopStations(limit = 20): Promise<RadioStation[]> {
    const response = await fetch(`${BASE_URL}/stations/topclick/${limit}`);
    return response.json();
  }

  static async searchStations(query: string, limit = 50): Promise<RadioStation[]> {
    const response = await fetch(`${BASE_URL}/stations/byname/${encodeURIComponent(query)}?limit=${limit}`);
    return response.json();
  }

  static async getStationsByTag(tag: string, limit = 50): Promise<RadioStation[]> {
    const response = await fetch(`${BASE_URL}/stations/bytag/${encodeURIComponent(tag)}?limit=${limit}`);
    return response.json();
  }

  static async getStationsByCountry(country: string, limit = 50): Promise<RadioStation[]> {
    const response = await fetch(`${BASE_URL}/stations/bycountry/${encodeURIComponent(country)}?limit=${limit}`);
    return response.json();
  }
}
