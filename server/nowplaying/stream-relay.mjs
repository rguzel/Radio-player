// HTTPS relay for HTTP-only stations.
//
// Browsers refuse to play http:// audio on an https:// page (mixed content),
// so the web player requests /api/stream?uuid=... instead and this pipes the
// station's stream through. Only stations whose Radio Browser URL is plain
// HTTP are relayed; HTTPS stations get a redirect to their own URL, so the
// relay only carries traffic the browser couldn't fetch itself.
//
// Each relayed listener costs the stream's bitrate twice (in and out), about
// 56 MB/hour at 128 kbps, so concurrent streams are capped overall and per client.

import { openStream } from './stream-client.mjs';

// Audio the <audio> element can play directly. Playlists (.m3u/.pls/HLS) and
// HTML error pages are refused.
const PLAYABLE_TYPE = /^(?:audio\/(?!x-mpegurl|mpegurl|x-scpls)|video\/|application\/(?:ogg|octet-stream))/i;

function sendError(res, status, message) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

export function createStreamRelay({
  getStreamUrl,
  lookup,
  open = openStream,
  maxStreams = 50,
  maxPerClient = 3,
  connectTimeoutMs = 10_000,
  idleTimeoutMs = 30_000,
  maxDurationMs = 6 * 60 * 60_000,
} = {}) {
  let active = 0;
  const perClient = new Map();

  async function handle(req, res, uuid, client) {
    if (active >= maxStreams) return sendError(res, 503, 'Relay is busy, try again later');
    if ((perClient.get(client) ?? 0) >= maxPerClient) return sendError(res, 429, 'Too many streams from this address');

    active++;
    perClient.set(client, (perClient.get(client) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      const count = (perClient.get(client) ?? 1) - 1;
      if (count > 0) perClient.set(client, count);
      else perClient.delete(client);
    };

    // Aborts the upstream connection whenever the listener goes away.
    const controller = new AbortController();
    res.on('close', () => {
      release();
      controller.abort();
    });

    try {
      const url = await getStreamUrl(uuid);
      if (!url) return sendError(res, 404, 'Station not found');
      if (!url.startsWith('http://')) {
        res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
        return res.end();
      }

      const connectTimer = setTimeout(() => controller.abort(new Error('Connect timeout')), connectTimeoutMs);
      let upstream;
      try {
        upstream = await open(url, { lookup, signal: controller.signal });
      } finally {
        clearTimeout(connectTimer);
      }

      const { status, headers, body } = upstream;
      const type = headers['content-type'] || 'audio/mpeg';
      if (status !== 200 || !PLAYABLE_TYPE.test(type) || res.destroyed) {
        body.destroy();
        if (status !== 200) return sendError(res, 502, `Station responded with HTTP ${status}`);
        return sendError(res, 415, `Unsupported stream type ${type}`);
      }

      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
      });

      // A stalled station or an overlong session ends the relay.
      body.setTimeout?.(idleTimeoutMs, () => body.destroy());
      const maxTimer = setTimeout(() => body.destroy(), maxDurationMs);
      body.on('close', () => {
        clearTimeout(maxTimer);
        res.end();
      });
      body.pipe(res);
    } catch {
      if (!res.destroyed) sendError(res, 502, 'Could not reach the station');
    }
  }

  return {
    handle,
    get activeStreams() {
      return active;
    },
  };
}
