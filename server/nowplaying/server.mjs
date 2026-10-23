// Now-playing endpoint for the web player.
//
//   GET /api/nowplaying?uuid=<Radio Browser station uuid>
//   200 { uuid, artist, title, raw, fetchedAt }   (artist/title null when unknown)
//   400 invalid uuid · 404 unknown station · 502 Radio Browser unreachable
//
// Takes a station uuid rather than a stream URL so it can't be used to make
// this server fetch arbitrary addresses.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createSafeLookup, readStreamTitle } from './icy.mjs';
import { createNowPlayingService } from './nowplaying.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body, cacheControl = 'no-store') {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

export function createServer(service) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/nowplaying') return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });

    const uuid = url.searchParams.get('uuid') ?? '';
    if (!UUID_PATTERN.test(uuid)) return send(res, 400, { error: 'Invalid uuid' });

    try {
      const result = await service.get(uuid.toLowerCase());
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

  createServer(service).listen(port, host, () => {
    console.log(`nowplaying listening on http://${host}:${port}/api/nowplaying`);
  });
}
