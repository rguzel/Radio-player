// Play counts from Guzel Radio's own listeners, for the "Most Played" tab.
//
// Radio Browser only exposes clicks for the last 24 hours, so this keeps its
// own tallies: hourly buckets for the rolling "day" (24 h) and "week" (7 d)
// windows, plus all-time totals. Everything lives in memory and is flushed to
// a small JSON file periodically and on shutdown.

import fs from 'node:fs/promises';
import path from 'node:path';

const HOUR_MS = 60 * 60_000;

/** Window length in hours for each period. */
export const PERIOD_HOURS = { day: 24, week: 24 * 7, all: Infinity };

const MAX_RECENT_ENTRIES = 100_000;

export function createPlayStats({
  file = null,
  now = () => Date.now(),
  // One play per listener per station in this window, so reloading or
  // pausing/resuming doesn't inflate counts.
  dedupeMs = 30 * 60_000,
  maxStations = 50_000,
} = {}) {
  const totals = new Map(); // uuid -> all-time plays
  const hours = new Map();  // hour index -> Map(uuid -> plays in that hour)
  const recent = new Map(); // "client|uuid" -> last counted time
  let dirty = false;

  const hourOf = time => Math.floor(time / HOUR_MS);

  function prune() {
    const oldestHour = hourOf(now()) - PERIOD_HOURS.week + 1;
    for (const hour of hours.keys()) if (hour < oldestHour) hours.delete(hour);
    const cutoff = now() - dedupeMs;
    for (const [key, time] of recent) if (time <= cutoff) recent.delete(key);
  }

  /** Counts a play; returns false when it was a duplicate or over capacity. */
  function record(uuid, client) {
    const time = now();
    const key = `${client}|${uuid}`;
    const last = recent.get(key);
    if (last !== undefined && time - last < dedupeMs) return false;
    if (!totals.has(uuid) && totals.size >= maxStations) return false;

    if (recent.size >= MAX_RECENT_ENTRIES) prune();
    recent.set(key, time);

    totals.set(uuid, (totals.get(uuid) ?? 0) + 1);
    const hour = hourOf(time);
    let bucket = hours.get(hour);
    if (!bucket) {
      bucket = new Map();
      hours.set(hour, bucket);
      prune();
    }
    bucket.set(uuid, (bucket.get(uuid) ?? 0) + 1);
    dirty = true;
    return true;
  }

  /** Most played stations for a period, highest first. */
  function top(period, limit = 50) {
    let counts = totals;
    if (period !== 'all') {
      const fromHour = hourOf(now()) - PERIOD_HOURS[period] + 1;
      counts = new Map();
      for (const [hour, bucket] of hours) {
        if (hour < fromHour) continue;
        for (const [uuid, plays] of bucket) counts.set(uuid, (counts.get(uuid) ?? 0) + plays);
      }
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([uuid, plays]) => ({ uuid, plays }));
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
    const isCount = value => Number.isInteger(value) && value > 0;
    for (const [uuid, plays] of Object.entries(data.totals ?? {})) if (isCount(plays)) totals.set(uuid, plays);
    for (const [hour, bucket] of Object.entries(data.hours ?? {})) {
      const entries = Object.entries(bucket ?? {}).filter(([, plays]) => isCount(plays));
      if (entries.length) hours.set(Number(hour), new Map(entries));
    }
    prune();
  }

  async function save() {
    if (!file || !dirty) return;
    dirty = false;
    const data = {
      version: 1,
      savedAt: new Date(now()).toISOString(),
      totals: Object.fromEntries(totals),
      hours: Object.fromEntries([...hours].map(([hour, bucket]) => [hour, Object.fromEntries(bucket)])),
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

  return { record, top, load, save };
}
