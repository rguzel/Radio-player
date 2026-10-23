import { useCallback, useEffect, useMemo, useState } from 'react';
import { RadioStation } from '../types';

const STORAGE_KEY = 'waveform_favorites';

function loadFavorites(): RadioStation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is RadioStation => typeof s?.stationuuid === 'string' && typeof s?.name === 'string');
  } catch {
    // Corrupt JSON or storage blocked (private mode): start with no favorites.
    return [];
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<RadioStation[]>(loadFavorites);
  const favoriteIds = useMemo(() => new Set(favorites.map(s => s.stationuuid)), [favorites]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // Storage full or blocked; favorites still work for this visit.
    }
  }, [favorites]);

  const toggleFavorite = useCallback((station: RadioStation) => {
    setFavorites(prev =>
      prev.some(s => s.stationuuid === station.stationuuid)
        ? prev.filter(s => s.stationuuid !== station.stationuuid)
        : [...prev, station]
    );
  }, []);

  const isFavorite = useCallback((uuid: string) => favoriteIds.has(uuid), [favoriteIds]);

  return { favorites, isFavorite, toggleFavorite };
}
