// Backend for the web player.
//
//   GET /api/nowplaying?uuid=<Radio Browser station uuid>
//   200 { uuid, artist, title, raw, fetchedAt }   (artist/title null when unknown)
//   400 invalid uuid · 404 unknown station · 502 Radio Browser unreachable
//
//   GET /api/stream?uuid=<Radio Browser station uuid>
//   200 the station's audio, relayed over HTTPS (HTTP-only stations)
//   302 to the station's own URL when it already serves HTTPS
//   400 invalid uuid · 404 unknown station · 415 playlist/non-audio stream
//   429 too many streams from this client · 502 station unreachable · 503 relay full
//
//   POST /api/plays?uuid=<Radio Browser station uuid>
//   204 play counted (at most once per listener per station every 30 min)
//
//   GET /api/plays/top?period=day|week|all&limit=50
//   200 { period, stations: [{ uuid, plays }] }   most played by Guzel Radio listeners
//
// Endpoints take a station uuid rather than a stream URL so they can't be used
// to make this server fetch arbitrary addresses.

import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSafeLookup, readStreamTitle } from './icy.mjs';
import { createNowPlayingService } from './nowplaying.mjs';
import { createPlayStats, PERIOD_HOURS } from './plays.mjs';
import { createStreamRelay } from './stream-relay.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body, cacheControl = 'no-store') {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

/** The listener's address: nginx's X-Real-IP, since this only listens locally. */
function clientAddress(req) {
  const realIp = req.headers['x-real-ip'];
  return (typeof realIp === 'string' && realIp) || req.socket.remoteAddress || 'unknown';
}

export function createServer(service, relay, plays) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = {
      '/api/nowplaying': { methods: ['GET', 'HEAD'], enabled: true },
      '/api/stream': { methods: ['GET', 'HEAD'], enabled: Boolean(relay) },
      '/api/plays': { methods: ['POST'], enabled: Boolean(plays) },
      '/api/plays/top': { methods: ['GET', 'HEAD'], enabled: Boolean(plays) },
    }[url.pathname];
    if (!route?.enabled) return send(res, 404, { error: 'Not found' });
    if (!route.methods.includes(req.method ?? '')) return send(res, 405, { error: 'Method not allowed' });

    if (url.pathname === '/api/plays/top') {
      const period = url.searchParams.get('period') ?? 'day';
      if (!Object.hasOwn(PERIOD_HOURS, period)) return send(res, 400, { error: 'period must be day, week or all' });
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      return send(res, 200, { period, stations: plays.top(period, limit) }, 'public, max-age=60');
    }

    const uuid = (url.searchParams.get('uuid') ?? '').toLowerCase();
    if (!UUID_PATTERN.test(uuid)) return send(res, 400, { error: 'Invalid uuid' });

    if (url.pathname === '/api/stream') return relay.handle(req, res, uuid, clientAddress(req));

    if (url.pathname === '/api/plays') {
      // Duplicates are ignored silently; the caller doesn't need to know.
      plays.record(uuid, clientAddress(req));
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    try {
      const result = await service.get(uuid);
      if (!result) return send(res, 404, { error: 'Station not found' });
      send(res, 200, result, 'public, max-age=10');
    } catch (error) {
      console.error(`nowplaying ${uuid}:`, error);
      send(res, 502, { error: 'Station directory unavailable' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3100);
  const host = process.env.HOST ?? '127.0.0.1';
  const lookup = createSafeLookup({ allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === '1' });
  const service = createNowPlayingService({ readTitle: url => readStreamTitle(url, { lookup }) });
  const relay = createStreamRelay({
    getStreamUrl: uuid => service.streamUrl(uuid),
    lookup,
    maxStreams: Number(process.env.RELAY_MAX_STREAMS ?? 50),
    maxPerClient: Number(process.env.RELAY_MAX_PER_CLIENT ?? 3),
  });

  // systemd's StateDirectory= sets STATE_DIRECTORY; PLAYS_FILE overrides it.
  const stateDir = process.env.STATE_DIRECTORY?.split(':')[0];
  const playsFile = process.env.PLAYS_FILE ?? (stateDir ? path.join(stateDir, 'plays.json') : null);
  const plays = createPlayStats({ file: playsFile });
  await plays.load();
  setInterval(() => plays.save(), 60_000).unref();
  if (!playsFile) console.warn('play stats are not persisted: set PLAYS_FILE or StateDirectory=');

  const server = createServer(service, relay, plays).listen(port, host, () => {
    console.log(`listening on http://${host}:${port} (/api/nowplaying, /api/stream, /api/plays)`);
  });

  const shutdown = async () => {
    server.close();
    await plays.save();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
