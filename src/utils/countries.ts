// Country names and flags for the country picker.

// Self-hosted SVG flags (emoji flags don't render on Windows). Only the
// flags actually shown are downloaded; `no-inline` keeps them out of the JS.
const flagModules = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?no-inline',
  import: 'default',
});

const flagsByCode = new Map(
  Object.entries(flagModules).map(([file, url]) => [file.slice(-6, -4).toUpperCase(), url])
);

export function flagUrl(code: string): string | undefined {
  return flagsByCode.get(code.toUpperCase());
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** Short English name, e.g. "United Kingdom" rather than Radio Browser's long form. */
export function countryName(code: string): string {
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export interface Country {
  code: string;
  name: string;
  /** Other names to match when searching (e.g. Radio Browser's "Turkey"). */
  aliases: string[];
  stations: number;
}

/** Shown first in the picker. */
export const PINNED_COUNTRY_CODES = ['CA', 'TR'];

/** Used until (or if) the full list can't be loaded from Radio Browser. */
export const FALLBACK_COUNTRIES: Country[] = ['CA', 'TR', 'AU', 'BR', 'FR', 'DE', 'IN', 'IT', 'JP', 'NL', 'ES', 'GB', 'US']
  .map(code => ({ code, name: countryName(code), aliases: [], stations: 0 }));

/** Lowercase, without accents, for forgiving search ("turkiye" finds "Türkiye"). */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
