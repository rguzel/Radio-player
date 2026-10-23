// Reads the current track from a Shoutcast/Icecast stream's in-band (ICY)
// metadata. The client asks for it with an `Icy-MetaData: 1` header; the server
// then interleaves a metadata block after every `icy-metaint` bytes of audio:
//
//   [metaint bytes of audio][1 length byte = N][N * 16 bytes of metadata] ...
//
// Metadata looks like: StreamTitle='Artist - Title';StreamUrl='';

import { createSafeLookup } from './safety.mjs';
import { openStream } from './stream-client.mjs';

export { createSafeLookup, isBlockedAddress } from './safety.mjs';

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

/**
 * Connects to a stream and resolves with its current "StreamTitle", or null
 * when the stream has no ICY metadata. Rejects on network/HTTP errors.
 */
export async function readStreamTitle(url, { timeoutMs = 8000, lookup = createSafeLookup() } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const { status, headers, body } = await openStream(url, { lookup, signal, headers: { 'Icy-MetaData': '1' } });

  try {
    if (status !== 200) throw new Error(`Stream responded with HTTP ${status}`);
    const metaInt = Number(headers['icy-metaint']);
    if (!Number.isInteger(metaInt) || metaInt <= 0 || metaInt > MAX_METAINT) return null;

    const reader = createIcyReader(metaInt);
    return await new Promise((resolve, reject) => {
      body.on('data', chunk => {
        const metadata = reader.push(chunk);
        if (metadata !== undefined) resolve(parseStreamTitle(metadata));
      });
      body.on('end', () => resolve(null));
      body.on('error', reject);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      body.resume();
    });
  } finally {
    body.destroy();
  }
}
