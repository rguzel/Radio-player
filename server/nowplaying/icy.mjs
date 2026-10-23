// Reads the current track from a Shoutcast/Icecast stream's in-band (ICY)
// metadata. The client asks for it with an `Icy-MetaData: 1` header; the server
// then interleaves a metadata block after every `icy-metaint` bytes of audio:
//
//   [metaint bytes of audio][1 length byte = N][N * 16 bytes of metadata] ...
//
// Metadata looks like: StreamTitle='Artist - Title';StreamUrl='';

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Real servers use 8 KB–32 KB; anything larger is not worth downloading.
const MAX_METAINT = 128 * 1024;

// Many servers send an empty block when the title hasn't changed, so read a
// couple of blocks before deciding there's no title.
const MAX_BLOCKS = 2;

/** Decodes metadata bytes: UTF-8 when valid, otherwise Latin-1 (older Shoutcast servers). */
export function decodeMetadata(bytes) {
  const trimmed = bytes.subarray(0, bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(trimmed);
  } catch {
    return new TextDecoder('latin1').decode(trimmed);
  }
}

/** Extracts the StreamTitle value, or null when absent or blank. */
export function parseStreamTitle(metadata) {
  const match = /StreamTitle='(.*?)';/s.exec(metadata);
  const title = match?.[1]?.trim();
  return title ? title : null;
}

/** Splits "Artist - Title" into its parts; titles without " - " are returned as-is. */
export function splitTrack(streamTitle) {
  if (!streamTitle) return { artist: null, title: null };
  const separator = streamTitle.indexOf(' - ');
  if (separator <= 0) return { artist: null, title: streamTitle };
  const artist = streamTitle.slice(0, separator).trim();
  const title = streamTitle.slice(separator + 3).trim();
  return title ? { artist: artist || null, title } : { artist: null, title: streamTitle };
}

/**
 * Incremental parser for an ICY stream body. Feed it chunks with push(); it
 * returns the decoded metadata string once a non-empty block (or MAX_BLOCKS
 * empty ones) has been read, and undefined while it needs more data.
 */
export function createIcyReader(metaInt, maxBlocks = MAX_BLOCKS) {
  let audioLeft = metaInt;
  let metaLeft = -1; // -1 = next byte is the length byte
  let parts = [];
  let blocks = 0;

  const finishBlock = text => {
    blocks++;
    if (text.trim() || blocks >= maxBlocks) return text;
    audioLeft = metaInt;
    metaLeft = -1;
    return undefined;
  };

  return {
    push(chunk) {
      let i = 0;
      while (i < chunk.length) {
        if (audioLeft > 0) {
          const n = Math.min(audioLeft, chunk.length - i);
          audioLeft -= n;
          i += n;
        } else if (metaLeft === -1) {
          metaLeft = chunk[i++] * 16;
          parts = [];
          if (metaLeft === 0) {
            const result = finishBlock('');
            if (result !== undefined) return result;
          }
        } else {
          const n = Math.min(metaLeft, chunk.length - i);
          parts.push(chunk.subarray(i, i + n));
          metaLeft -= n;
          i += n;
          if (metaLeft === 0) {
            const result = finishBlock(decodeMetadata(Buffer.concat(parts)));
            if (result !== undefined) return result;
          }
        }
      }
      return undefined;
    },
  };
}

// Addresses a public stream URL must never resolve to (loopback, private
// ranges, link-local/cloud metadata, multicast, reserved).
const blockedRanges = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blockedRanges.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blockedRanges.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blockedRanges.check(mapped[1], 'ipv4');
  return blockedRanges.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/**
 * dns.lookup replacement that refuses blocked addresses. Used as the socket's
 * lookup function, so the check applies to the address actually connected to
 * (no DNS-rebinding gap) and to every redirect hop.
 */
export function createSafeLookup({ allowPrivateNetworks = false } = {}) {
  const lookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const blocked = allowPrivateNetworks ? undefined : addresses.find(a => isBlockedAddress(a.address));
      if (blocked) return callback(Object.assign(new Error(`Blocked address ${blocked.address}`), { code: 'EBLOCKED' }));
      if (options?.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
  // Node skips the lookup function for IP-literal hosts, so readStreamTitle
  // checks those itself with this.
  lookup.isAllowed = address => allowPrivateNetworks || !isBlockedAddress(address);
  return lookup;
}

/**
 * Connects to a stream and resolves with its current "StreamTitle", or null
 * when the stream has no ICY metadata. Rejects on network/HTTP errors.
 */
export function readStreamTitle(url, { timeoutMs = 8000, maxRedirects = 3, lookup = createSafeLookup() } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);

  const attempt = (target, redirectsLeft) => new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return reject(new Error('Invalid stream URL'));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error(`Unsupported protocol ${parsed.protocol}`));
    }

    const literalIp = parsed.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literalIp) && lookup.isAllowed?.(literalIp) === false) {
      return reject(Object.assign(new Error(`Blocked address ${literalIp}`), { code: 'EBLOCKED' }));
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'GuzelRadio-NowPlaying/1.0' },
      lookup,
      signal,
    }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        req.destroy();
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        return resolve(attempt(new URL(res.headers.location, parsed).toString(), redirectsLeft - 1));
      }
      if (status !== 200) {
        req.destroy();
        return reject(new Error(`Stream responded with HTTP ${status}`));
      }

      const metaInt = Number(res.headers['icy-metaint']);
      if (!Number.isInteger(metaInt) || metaInt <= 0 || metaInt > MAX_METAINT) {
        req.destroy();
        return resolve(null);
      }

      const reader = createIcyReader(metaInt);
      res.on('data', chunk => {
        const metadata = reader.push(chunk);
        if (metadata !== undefined) {
          req.destroy();
          resolve(parseStreamTitle(metadata));
        }
      });
      res.on('end', () => resolve(null));
      res.on('error', reject);
    });
    req.on('error', reject);
  });

  return attempt(url, maxRedirects);
}
