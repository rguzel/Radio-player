// Caching pass-through for Radio Browser's station lists, mounted at
// /api/rb/json/... so a client can point its Radio Browser base URL here.
//
// The Android app has no mirror failover of its own in older releases, and
// Radio Browser has outages. This answers from a fresh cache when it can, asks
// the mirrors when the entry is stale, and falls back to the stale copy (any
// age) when every mirror is down. A background refresh keeps the app's
// default lists warm. Only fixed paths and known query parameters are
// forwarded, so it can't be used to fetch arbitrary addresses.

import fs from 'node:fs/promises';
import path from 'node:path';

const SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
];

const PATHS = [/^stations\/bycountry\/[^/]{1,64}$/, /^stations\/search$/, /^stations\/byuuid$/, /^countries$/];
const PARAMS = {
  limit: /^\d{1,3}$/, offset: /^\d{1,6}$/, hidebroken: /^(true|false)$/, reverse: /^(true|false)$/,
  order: /^[a-z_]{1,20}$/, tagList: /^[^\0]{1,64}$/, country: /^[^\0]{1,64}$/, name: /^[^\0]{1,64}$/,
  uuids: /^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,99}$/i,
};
const MAX_LIMIT = 200;

/** Cache key (and upstream query) for a request, or null when it isn't allowed. */
export function normalizeRequest(rest, searchParams) {
  if (!PATHS.some(p => p.test(rest))) return null;
  const query = new URLSearchParams();
  for (const key of [...new Set(searchParams.keys())].sort()) {
    const value = searchParams.get(key);
    if (!Object.hasOwn(PARAMS, key) || !PARAMS[key].test(value)) return null;
    if (key === 'limit' && Number(value) > MAX_LIMIT) return null;
    query.set(key, value);
  }
  return { key: `${rest}?${query}`, rest, query: query.toString() };
}

export function createStationsCache({
  file = null,
  fetchFn = fetch,
  servers = SERVERS,
  freshMs = 10 * 60_000,
  maxEntries = 500,
  now = () => Date.now(),
} = {}) {
  const entries = new Map(); // key -> { body, fetchedAt }
  const inFlight = new Map();

  async function load() {
    if (!file) return;
    try {
      for (const [key, entry] of Object.entries(JSON.parse(await fs.readFile(file, 'utf8')))) entries.set(key, entry);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('stations cache not loaded:', error.message);
    }
  }

  async function save() {
    if (!file) return;
    const tmp = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(entries)));
    await fs.rename(tmp, file);
  }

  async function fetchUpstream({ rest, query }) {
    let lastError;
    for (const server of servers) {
      try {
        const response = await fetchFn(`${server}/json/${rest}${query ? `?${query}` : ''}`, {
          headers: { 'User-Agent': 'GuzelRadio-Cache/1.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        JSON.parse(body); // never cache an error page
        return body;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  /** Resolves { body, stale } or throws when there is neither a mirror nor a cached copy. */
  async function get(request, { refresh = false } = {}) {
    const cached = entries.get(request.key);
    if (cached && !refresh && now() - cached.fetchedAt < freshMs) return { body: cached.body, stale: false };

    let pending = inFlight.get(request.key);
    if (!pending) {
      pending = fetchUpstream(request)
        .then(body => {
          if (entries.size >= maxEntries && !entries.has(request.key)) entries.delete(entries.keys().next().value);
          entries.set(request.key, { body, fetchedAt: now() });
          return body;
        })
        .finally(() => inFlight.delete(request.key));
      inFlight.set(request.key, pending);
    }
    try {
      return { body: await pending, stale: false };
    } catch (error) {
      if (cached) return { body: cached.body, stale: true };
      throw error;
    }
  }

  /** Re-fetches the lists the app opens first, so they're cached before an outage. */
  async function warm(requests) {
    for (const request of requests) {
      try {
        await get(request, { refresh: true });
      } catch {
        // Radio Browser is down; the existing copy stays.
      }
    }
    await save().catch(error => console.warn('stations cache not saved:', error.message));
  }

  return { get, warm, load, save, size: () => entries.size };
}

/** The app's first page for each category, for the default country. */
export function defaultWarmRequests(country = 'Türkiye', tags = ['pop', 'classical', 'news', 'arabesk', 'international', 'broadcast', 'comedy']) {
  const list = { limit: '100', offset: '0', hidebroken: 'true', order: 'clickcount', reverse: 'true' };
  const requests = [
    [`stations/bycountry/${encodeURIComponent(country)}`, list],
    ...tags.map(tagList => ['stations/search', { ...list, tagList, country }]),
    ['countries', { order: 'name' }],
  ];
  return requests.map(([rest, params]) => normalizeRequest(decodeURIComponent(rest), new URLSearchParams(params)));
}
