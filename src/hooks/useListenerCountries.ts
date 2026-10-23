import { useCallback, useEffect, useState } from 'react';
import { CountryPlays, PlayPeriod, PlayStatsService } from '../services/playStatsService';

/**
 * Plays per listener country for the Listeners tab. Loads only while
 * `enabled`, and again whenever the period changes or `reload` is called.
 */
export function useListenerCountries(period: PlayPeriod, enabled: boolean) {
  const [countries, setCountries] = useState<CountryPlays[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    PlayStatsService.getListenerCountries(period, controller.signal)
      .then(data => setCountries(data))
      .catch(err => {
        if (controller.signal.aborted) return;
        console.error('Failed to load listener countries:', err);
        setCountries([]);
        setError('Could not load listener statistics. Try again in a moment.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [period, enabled, attempt]);

  const reload = useCallback(() => setAttempt(n => n + 1), []);

  return { countries, isLoading, error, reload };
}
