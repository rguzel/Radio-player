import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  createIcyReader, createSafeLookup, decodeMetadata, isBlockedAddress,
  parseStreamTitle, readStreamTitle, splitTrack,
} from './icy.mjs';
import { createNowPlayingService } from './nowplaying.mjs';
import { createServer } from './server.mjs';

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
