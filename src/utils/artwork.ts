import { RadioStation } from '../types';

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * Builds an initials avatar as an inline SVG data URI, so stations without a
 * favicon get artwork without calling a third-party avatar service.
 */
export function initialsArtwork(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => Array.from(word)[0]?.toUpperCase() ?? '')
    .join('') || '?';
  const text = initials.replace(/[&<>"']/g, ch => XML_ESCAPES[ch]);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" fill="#1e293b"/>' +
    '<text x="64" y="64" dy=".35em" text-anchor="middle" font-family="system-ui, sans-serif" ' +
    `font-size="48" font-weight="700" fill="#f8fafc">${text}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function stationArtwork(station: RadioStation): string {
  return station.favicon || initialsArtwork(station.name);
}

/** <img> onError handler: swap a broken favicon for the initials avatar, once. */
export function fallbackToInitials(event: React.SyntheticEvent<HTMLImageElement>, name: string) {
  const img = event.currentTarget;
  const fallback = initialsArtwork(name);
  if (img.src !== fallback) img.src = fallback;
}

export function primaryTag(station: RadioStation): string | undefined {
  return station.tags?.split(',')[0]?.trim() || undefined;
}
