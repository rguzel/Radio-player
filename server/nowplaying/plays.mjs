// Play counts from Guzel Radio's own listeners, for the "Most Played" and
// "Listeners" tabs.
//
// Radio Browser only exposes clicks for the last 24 hours, so this keeps its
// own tallies, per station and per listener country: hourly buckets for the
// rolling "day" (24 h) and "week" (7 d) windows, plus all-time totals.
// Everything lives in memory and is flushed to a small JSON file periodically
// and on shutdown. Listener addresses are only kept in memory, for the
// duplicate check, and never written to disk.

import fs from 'node:fs/promises';
import path from 'node:path';

const HOUR_MS = 60 * 60_000;

/** Window length in hours for each period. */
export const PERIOD_HOURS = { day: 24, week: 24 * 7, all: Infinity };

/** Country code used when the listener's country isn't known. */
export const UNKNOWN_COUNTRY = 'XX';

const MAX_RECENT_ENTRIES = 100_000;

/**
 * Two-letter country code from Cloudflare's CF-IPCountry (passed on by nginx),
 * or UNKNOWN_COUNTRY. Cloudflare's own XX (unknown) and T1 (Tor) count as unknown.
 */
export function normalizeCountry(code) {
  const upper = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(upper) ? upper : UNKNOWN_COUNTRY;
}

/** Plays per key (station uuid or country): hourly buckets plus all-time totals. */
function createTally() {
  const totals = new Map(); // key -> all-time plays
  const hours = new Map();  // hour index -> Map(key -> plays in that hour)

  return {
    totals,

    add(key, hour) {
      totals.set(key, (totals.get(key) ?? 0) + 1);
      let bucket = hours.get(hour);
      if (!bucket) hours.set(hour, bucket = new Map());
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    },

    hasHour: hour => hours.has(hour),

    prune(oldestHour) {
      for (const hour of hours.keys()) if (hour < oldestHour) hours.delete(hour);
    },

    /** Counts since fromHour (all-time totals when fromHour is null), highest first. */
    top(fromHour, limit) {
      let counts = totals;
      if (fromHour !== null) {
        counts = new Map();
        for (const [hour, bucket] of hours) {
          if (hour < fromHour) continue;
          for (const [key, plays] of bucket) counts.set(key, (counts.get(key) ?? 0) + plays);
        }
      }
      return [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit);
    },

    toJSON() {
      return {
        totals: Object.fromEntries(totals),
        hours: Object.fromEntries([...hours].map(([hour, bucket]) => [hour, Object.fromEntries(bucket)])),
      };
    },

    load(data) {
      const isCount = value => Number.isInteger(value) && value > 0;
      for (const [key, plays] of Object.entries(data?.totals ?? {})) if (isCount(plays)) totals.set(key, plays);
      for (const [hour, bucket] of Object.entries(data?.hours ?? {})) {
        const entries = Object.entries(bucket ?? {}).filter(([, plays]) => isCount(plays));
        if (entries.length) hours.set(Number(hour), new Map(entries));
      }
    },
  };
}

export function createPlayStats({
  file = null,
  now = () => Date.now(),
  // One play per listener per station in this window, so reloading or
  // pausing/resuming doesn't inflate counts.
  dedupeMs = 30 * 60_000,
  maxStations = 50_000,
} = {}) {
  const stations = createTally();
  const countries = createTally();
  const recent = new Map(); // "client|uuid" -> last counted time
  let dirty = false;

  const hourOf = time => Math.floor(time / HOUR_MS);

  function prune() {
    const oldestHour = hourOf(now()) - PERIOD_HOURS.week + 1;
    stations.prune(oldestHour);
    countries.prune(oldestHour);
    const cutoff = now() - dedupeMs;
    for (const [key, time] of recent) if (time <= cutoff) recent.delete(key);
  }

  /** Counts a play; returns false when it was a duplicate or over capacity. */
  function record(uuid, client, country) {
    const time = now();
    const key = `${client}|${uuid}`;
    const last = recent.get(key);
    if (last !== undefined && time - last < dedupeMs) return false;
    if (!stations.totals.has(uuid) && stations.totals.size >= maxStations) return false;

    if (recent.size >= MAX_RECENT_ENTRIES) prune();
    recent.set(key, time);

    const hour = hourOf(time);
    const newHour = !stations.hasHour(hour);
    stations.add(uuid, hour);
    countries.add(normalizeCountry(country), hour);
    if (newHour) prune();
    dirty = true;
    return true;
  }

  const fromHour = period => (period === 'all' ? null : hourOf(now()) - PERIOD_HOURS[period] + 1);

  /** Most played stations for a period, highest first. */
  function top(period, limit = 50) {
    return stations.top(fromHour(period), limit).map(([uuid, plays]) => ({ uuid, plays }));
  }

  /** Plays per listener country for a period, highest first. */
  function topCountries(period, limit = 250) {
    return countries.top(fromHour(period), limit).map(([country, plays]) => ({ country, plays }));
  }

  async function load() {
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      // Keep a corrupt file aside rather than overwriting it on the next save.
      const aside = `${file}.corrupt-${now()}`;
      await fs.rename(file, aside).catch(() => {});
      console.error(`play stats: could not read ${file} (${error.message}); moved to ${aside}`);
      return;
    }
    // Station tallies sit at the top level (the original file format).
    stations.load(data);
    countries.load(data.countries);
    prune();
  }

  async function save() {
    if (!file || !dirty) return;
    dirty = false;
    const data = {
      version: 1,
      savedAt: new Date(now()).toISOString(),
      ...stations.toJSON(),
      countries: countries.toJSON(),
    };
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(data));
      await fs.rename(temp, file); // atomic replace
    } catch (error) {
      dirty = true;
      console.error(`play stats: could not save ${file}: ${error.message}`);
    }
  }

  return { record, top, topCountries, load, save };
}
