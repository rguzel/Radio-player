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
// Both take a station uuid rather than a stream URL so they can't be used to
// make this server fetch arbitrary addresses.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createSafeLookup, readStreamTitle } from './icy.mjs';
import { createNowPlayingService } from './nowplaying.mjs';
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

export function createServer(service, relay) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isNowPlaying = url.pathname === '/api/nowplaying';
    const isStream = url.pathname === '/api/stream' && relay;
    if (!isNowPlaying && !isStream) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    const uuid = (url.searchParams.get('uuid') ?? '').toLowerCase();
    if (!UUID_PATTERN.test(uuid)) return send(res, 400, { error: 'Invalid uuid' });

    if (isStream) return relay.handle(req, res, uuid, clientAddress(req));

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

  createServer(service, relay).listen(port, host, () => {
    console.log(`listening on http://${host}:${port} (/api/nowplaying, /api/stream)`);
  });
}
