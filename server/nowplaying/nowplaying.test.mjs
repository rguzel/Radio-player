import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import {
  createIcyReader, createSafeLookup, decodeMetadata, isBlockedAddress,
  parseStreamTitle, readStreamTitle, splitTrack,
} from './icy.mjs';
import { createNowPlayingService } from './nowplaying.mjs';
import { createServer } from './server.mjs';
import { openStream } from './stream-client.mjs';
import { createStreamRelay } from './stream-relay.mjs';
import { createPlayStats } from './plays.mjs';

/** Builds an ICY body: one metaint of audio followed by each metadata block. */
function icyBody(metaInt, ...blocks) {
  const parts = [];
  for (const text of blocks) {
    parts.push(Buffer.alloc(metaInt, 0xaa));
    const bytes = Buffer.from(text, 'utf8');
    const length = Math.ceil(bytes.length / 16);
    const padded = Buffer.alloc(length * 16);
    bytes.copy(padded);
    parts.push(Buffer.from([length]), padded);
  }
  parts.push(Buffer.alloc(metaInt, 0xaa));
  return Buffer.concat(parts);
}

describe('ICY parsing', () => {
  it('extracts StreamTitle, including apostrophes', () => {
    assert.equal(parseStreamTitle("StreamTitle='Don't Stop - Queen';StreamUrl='';"), "Don't Stop - Queen");
    assert.equal(parseStreamTitle("StreamTitle='';"), null);
    assert.equal(parseStreamTitle('nothing here'), null);
  });

  it('splits artist and title', () => {
    assert.deepEqual(splitTrack('Tarkan - Şımarık'), { artist: 'Tarkan', title: 'Şımarık' });
    assert.deepEqual(splitTrack('Morning News'), { artist: null, title: 'Morning News' });
    assert.deepEqual(splitTrack('AC - DC - Thunderstruck'), { artist: 'AC', title: 'DC - Thunderstruck' });
    assert.deepEqual(splitTrack(null), { artist: null, title: null });
  });

  it('decodes UTF-8 and falls back to Latin-1', () => {
    assert.equal(decodeMetadata(Buffer.from('Şımarık\0\0\0', 'utf8')), 'Şımarık');
    assert.equal(decodeMetadata(Buffer.from([0x43, 0x61, 0x66, 0xe9])), 'Café');
  });

  it('reads metadata split across arbitrary chunk boundaries', () => {
    const body = icyBody(100, "StreamTitle='Artist - Song';");
    for (const size of [1, 7, 100, 101, body.length]) {
      const reader = createIcyReader(100);
      let result;
      for (let i = 0; i < body.length && result === undefined; i += size) result = reader.push(body.subarray(i, i + size));
      assert.equal(parseStreamTitle(result), 'Artist - Song', `chunk size ${size}`);
    }
  });

  it('skips an empty block and reads the next one', () => {
    const empty = Buffer.concat([Buffer.alloc(10), Buffer.from([0])]);
    const reader = createIcyReader(10);
    assert.equal(reader.push(empty), undefined);
    assert.equal(parseStreamTitle(reader.push(icyBody(10, "StreamTitle='Second';"))), 'Second');
  });
});

describe('address blocking', () => {
  it('blocks private, loopback, link-local and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
  });

  it('refuses to connect to a stream on a private address', async () => {
    const lookup = createSafeLookup();
    for (const url of ['http://127.0.0.1:9/stream', 'http://[::1]:9/stream', 'http://169.254.169.254/latest', 'http://localhost:9/stream']) {
      await assert.rejects(readStreamTitle(url, { lookup }), /Blocked address/, url);
    }
  });
});

describe('readStreamTitle against a local stream', () => {
  let server;
  let base;
  const lookup = createSafeLookup({ allowPrivateNetworks: true });

  before(async () => {
    server = http.createServer((req, res) => {
      const icy = req.headers['icy-metadata'] === '1';
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/live' });
        return res.end();
      }
      if (req.url === '/plain') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        return res.end(Buffer.alloc(1000));
      }
      if (req.url === '/live' && icy) {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '512' });
        // Stream like a real server: the body never ends on its own.
        res.write(icyBody(512, "StreamTitle='Sezen Aksu - Firuze';"));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.closeAllConnections() || server.close());

  it('reads the title and closes the connection', async () => {
    assert.equal(await readStreamTitle(`${base}/live`, { lookup }), 'Sezen Aksu - Firuze');
  });

  it('follows redirects', async () => {
    assert.equal(await readStreamTitle(`${base}/redirect`, { lookup }), 'Sezen Aksu - Firuze');
  });

  it('returns null for streams without ICY metadata', async () => {
    assert.equal(await readStreamTitle(`${base}/plain`, { lookup }), null);
  });

  it('rejects HTTP errors and non-http protocols', async () => {
    await assert.rejects(readStreamTitle(`${base}/missing`, { lookup }), /HTTP 404/);
    await assert.rejects(readStreamTitle('file:///etc/passwd', { lookup }), /Unsupported protocol/);
  });
});

describe('now-playing service', () => {
  it('caches results and shares in-flight lookups', async () => {
    let reads = 0;
    let clock = 0;
    const service = createNowPlayingService({
      resolveStreamUrl: async () => 'http://stream.example/live',
      readTitle: async () => { reads++; return 'Artist - Title'; },
      now: () => clock,
    });
    const [a, b] = await Promise.all([service.get('id'), service.get('id')]);
    assert.equal(reads, 1);
    assert.deepEqual([a.artist, a.title], ['Artist', 'Title']);
    assert.equal(a, b);
    clock += 10_000;
    await service.get('id');
    assert.equal(reads, 1, 'served from cache within ttl');
    clock += 10_000;
    await service.get('id');
    assert.equal(reads, 2, 'refreshed after ttl');
  });

  it('reports unknown stations as null and stream failures as no track', async () => {
    const service = createNowPlayingService({
      resolveStreamUrl: async uuid => (uuid === 'known' ? 'http://stream.example/live' : null),
      readTitle: async () => { throw new Error('offline'); },
    });
    assert.equal(await service.get('unknown'), null);
    const result = await service.get('known');
    assert.deepEqual([result.artist, result.title, result.raw], [null, null, null]);
  });
});

describe('HTTP endpoint', () => {
  let server;
  let base;
  const uuid = '9617a958-0601-11e8-ae97-52543be04c81';

  before(async () => {
    server = createServer({
      get: async id => (id === uuid ? { uuid, artist: 'A', title: 'T', raw: 'A - T' } : null),
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('validates input and maps results to status codes', async () => {
    const ok = await fetch(`${base}/api/nowplaying?uuid=${uuid}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /application\/json/);
    assert.equal((await ok.json()).title, 'T');

    assert.equal((await fetch(`${base}/api/nowplaying?uuid=http://evil`)).status, 400);
    assert.equal((await fetch(`${base}/api/nowplaying?uuid=00000000-0000-0000-0000-000000000000`)).status, 404);
    assert.equal((await fetch(`${base}/other`)).status, 404);
  });
});

describe('SHOUTcast "ICY 200 OK" responses', () => {
  let server;
  let base;
  const lookup = createSafeLookup({ allowPrivateNetworks: true });

  before(async () => {
    // Raw TCP: Node's http server can't produce an ICY status line.
    server = net.createServer(socket => {
      socket.once('data', () => {
        socket.write('ICY 200 OK\r\nicy-name: Old Shoutcast\r\nContent-Type: audio/mpeg\r\nicy-metaint: 256\r\n\r\n');
        socket.write(icyBody(256, "StreamTitle='Barış Manço - Gülpembe';"));
      });
      socket.on('error', () => {});
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  it('reads titles from ICY status-line servers', async () => {
    assert.equal(await readStreamTitle(`${base}/;`, { lookup }), 'Barış Manço - Gülpembe');
  });

  it('opens them as streams', async () => {
    const { status, headers, body } = await openStream(`${base}/;`, { lookup });
    body.destroy();
    assert.equal(status, 200);
    assert.equal(headers['icy-name'], 'Old Shoutcast');
  });
});

describe('stream relay', () => {
  let upstream;
  let upstreamBase;
  let openConnections = 0;
  const lookup = createSafeLookup({ allowPrivateNetworks: true });

  before(async () => {
    upstream = http.createServer((req, res) => {
      if (req.url === '/playlist') {
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
        return res.end('#EXTM3U\n');
      }
      openConnections++;
      res.on('close', () => openConnections--);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.write(Buffer.alloc(4096, 0x55)); // keeps streaming until the client leaves
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
  });

  after(() => upstream.closeAllConnections() || upstream.close());

  async function startRelay(options = {}) {
    const urls = {
      [uuidOf(1)]: `${upstreamBase}/live`,
      [uuidOf(2)]: 'https://secure.example/stream',
      [uuidOf(3)]: `${upstreamBase}/playlist`,
      [uuidOf(4)]: 'http://127.0.0.1:9/private',
    };
    const relay = createStreamRelay({ getStreamUrl: async id => urls[id] ?? null, lookup, ...options });
    const server = createServer({ get: async () => null }, relay);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { relay, server, base: `http://127.0.0.1:${server.address().port}` };
  }

  const uuidOf = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const waitUntil = async (condition, ms = 2000) => {
    const end = Date.now() + ms;
    while (!condition() && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    return condition();
  };

  it('relays audio and closes upstream when the listener leaves', async () => {
    const { relay, server, base } = await startRelay();
    const controller = new AbortController();
    const response = await fetch(`${base}/api/stream?uuid=${uuidOf(1)}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    const reader = response.body.getReader();
    const { value } = await reader.read();
    assert.ok(value.length > 0 && value[0] === 0x55);
    assert.equal(relay.activeStreams, 1);

    controller.abort();
    assert.ok(await waitUntil(() => relay.activeStreams === 0 && openConnections === 0), 'slot released and upstream closed');
    server.close();
  });

  it('redirects stations that already serve HTTPS', async () => {
    const { server, base } = await startRelay();
    const response = await fetch(`${base}/api/stream?uuid=${uuidOf(2)}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://secure.example/stream');
    server.close();
  });

  it('refuses playlists, unknown stations and private addresses', async () => {
    const { server, base } = await startRelay({ lookup: createSafeLookup() });
    assert.equal((await fetch(`${base}/api/stream?uuid=${uuidOf(9)}`)).status, 404);
    assert.equal((await fetch(`${base}/api/stream?uuid=${uuidOf(4)}`)).status, 502);
    assert.equal((await fetch(`${base}/api/stream?uuid=bad`)).status, 400);
    server.close();

    const open = await startRelay();
    assert.equal((await fetch(`${open.base}/api/stream?uuid=${uuidOf(3)}`)).status, 415);
    open.server.close();
  });

  it('caps streams per client and overall', async () => {
    const { server, base } = await startRelay({ maxPerClient: 1, maxStreams: 2 });
    const first = new AbortController();
    const a = await fetch(`${base}/api/stream?uuid=${uuidOf(1)}`, { signal: first.signal, headers: { 'X-Real-IP': '203.0.113.1' } });
    assert.equal(a.status, 200);
    const b = await fetch(`${base}/api/stream?uuid=${uuidOf(1)}`, { headers: { 'X-Real-IP': '203.0.113.1' } });
    assert.equal(b.status, 429);

    const second = new AbortController();
    const c = await fetch(`${base}/api/stream?uuid=${uuidOf(1)}`, { signal: second.signal, headers: { 'X-Real-IP': '203.0.113.2' } });
    assert.equal(c.status, 200);
    const d = await fetch(`${base}/api/stream?uuid=${uuidOf(1)}`, { headers: { 'X-Real-IP': '203.0.113.3' } });
    assert.equal(d.status, 503);

    first.abort();
    second.abort();
    server.close();
  });
});

describe('play stats', () => {
  const HOUR = 60 * 60_000;
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';

  it('counts once per listener per station within the dedupe window', () => {
    let clock = 1_000 * HOUR;
    const stats = createPlayStats({ now: () => clock });
    assert.equal(stats.record(A, 'ip1'), true);
    assert.equal(stats.record(A, 'ip1'), false, 'same listener again');
    assert.equal(stats.record(A, 'ip2'), true, 'another listener');
    assert.equal(stats.record(B, 'ip1'), true, 'another station');
    clock += 31 * 60_000;
    assert.equal(stats.record(A, 'ip1'), true, 'after the window');
    assert.deepEqual(stats.top('day'), [{ uuid: A, plays: 3 }, { uuid: B, plays: 1 }]);
  });

  it('rolls plays out of the day and week windows but keeps all-time totals', () => {
    let clock = 1_000 * HOUR;
    const stats = createPlayStats({ now: () => clock });
    stats.record(A, 'ip1');
    clock += 2 * 24 * HOUR;              // 2 days later
    stats.record(B, 'ip1');
    stats.record(B, 'ip2');
    assert.deepEqual(stats.top('day').map(s => s.uuid), [B]);
    assert.deepEqual(stats.top('week'), [{ uuid: B, plays: 2 }, { uuid: A, plays: 1 }]);
    clock += 7 * 24 * HOUR;              // 9 days after A's play
    stats.record(B, 'ip3');
    assert.deepEqual(stats.top('week'), [{ uuid: B, plays: 1 }]);
    assert.deepEqual(stats.top('all'), [{ uuid: B, plays: 3 }, { uuid: A, plays: 1 }]);
  });

  it('persists to disk and survives a corrupt file', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plays-'));
    const file = path.join(dir, 'plays.json');
    const clock = 1_000 * HOUR;

    const first = createPlayStats({ file, now: () => clock });
    first.record(A, 'ip1');
    first.record(B, 'ip1');
    first.record(B, 'ip2');
    await first.save();

    const second = createPlayStats({ file, now: () => clock });
    await second.load();
    assert.deepEqual(second.top('day'), [{ uuid: B, plays: 2 }, { uuid: A, plays: 1 }]);
    assert.deepEqual(second.top('all'), second.top('day'));

    await fs.writeFile(file, '{not json');
    const third = createPlayStats({ file, now: () => clock });
    await third.load();
    assert.deepEqual(third.top('all'), []);
    assert.ok((await fs.readdir(dir)).some(name => name.startsWith('plays.json.corrupt-')), 'corrupt file kept aside');
    await fs.rm(dir, { recursive: true });
  });

  it('exposes record and top over HTTP', async () => {
    const stats = createPlayStats();
    const server = createServer({ get: async () => null }, null, stats);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    assert.equal((await fetch(`${base}/api/plays?uuid=${A}`, { method: 'POST', headers: { 'X-Real-IP': '203.0.113.9' } })).status, 204);
    assert.equal((await fetch(`${base}/api/plays?uuid=${A}`, { method: 'POST', headers: { 'X-Real-IP': '203.0.113.9' } })).status, 204);
    assert.equal((await fetch(`${base}/api/plays?uuid=${A}`)).status, 405, 'GET not allowed for recording');
    assert.equal((await fetch(`${base}/api/plays?uuid=nope`, { method: 'POST' })).status, 400);

    const top = await fetch(`${base}/api/plays/top?period=week`);
    assert.equal(top.status, 200);
    assert.deepEqual(await top.json(), { period: 'week', stations: [{ uuid: A, plays: 1 }] });
    assert.equal((await fetch(`${base}/api/plays/top?period=constructor`)).status, 400);
    assert.equal((await fetch(`${base}/api/stream?uuid=${A}`)).status, 404, 'relay disabled when not configured');
    server.close();
  });
});
