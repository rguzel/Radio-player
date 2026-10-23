// Minimal client for opening radio streams.
//
// Node's http module rejects the "ICY 200 OK" status line that SHOUTcast v1
// servers (common among HTTP-only stations) send instead of "HTTP/1.x 200 OK",
// so this speaks HTTP/1.0 over a raw TCP/TLS socket and accepts both. HTTP/1.0
// also means the body is never chunked: it's the raw stream until the socket
// closes.

import net from 'node:net';
import tls from 'node:tls';
import { createSafeLookup } from './safety.mjs';

const MAX_HEADER_BYTES = 16 * 1024;
const STATUS_LINE = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})/;

function blocked(address) {
  return Object.assign(new Error(`Blocked address ${address}`), { code: 'EBLOCKED' });
}

/**
 * Opens a single request. Resolves with { status, headers, body } where body is
 * the socket, paused at the start of the response body: pipe() it or call
 * resume() after attaching listeners.
 */
function request(target, { lookup, headers, signal }) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(target);
    } catch {
      return reject(new Error('Invalid stream URL'));
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return reject(new Error(`Unsupported protocol ${url.protocol}`));
    }

    // Node skips custom lookup functions for IP-literal hosts; check those here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && lookup.isAllowed?.(host) === false) return reject(blocked(host));

    const secure = url.protocol === 'https:';
    const port = Number(url.port) || (secure ? 443 : 80);
    const options = { host, port, lookup };
    const socket = secure
      ? tls.connect({ ...options, servername: net.isIP(host) ? undefined : host })
      : net.connect(options);

    const fail = error => {
      socket.destroy();
      reject(error);
    };
    const onAbort = () => fail(signal.reason ?? new Error('Aborted'));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    socket.once('error', fail);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      const lines = [
        `GET ${url.pathname}${url.search} HTTP/1.0`,
        `Host: ${url.host}`,
        'Accept: */*',
        'Connection: close',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      ];
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });

    let buffered = Buffer.alloc(0);
    const onData = chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buffered.length > MAX_HEADER_BYTES) fail(new Error('Response headers too large'));
        return;
      }

      socket.off('data', onData);
      socket.pause();
      socket.off('error', fail);
      signal?.removeEventListener('abort', onAbort);

      const [statusLine, ...headerLines] = buffered.subarray(0, end).toString('latin1').split('\r\n');
      const match = STATUS_LINE.exec(statusLine);
      if (!match) return fail(new Error(`Unexpected response: ${statusLine.slice(0, 40)}`));

      const responseHeaders = {};
      for (const line of headerLines) {
        const colon = line.indexOf(':');
        if (colon > 0) responseHeaders[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
      }

      // Late socket errors must not crash the process if the caller hasn't
      // attached its own handler yet; callers still get 'close'/'end'.
      socket.on('error', () => {});

      const rest = buffered.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      // Abort after the headers still tears the connection down.
      signal?.addEventListener('abort', () => socket.destroy(), { once: true });
      resolve({ status: Number(match[1]), headers: responseHeaders, body: socket, url: url.href });
    };
    socket.on('data', onData);
  });
}

/**
 * Opens a stream, following up to `maxRedirects` redirects (each hop is
 * subject to the same address checks). Resolves for any final status; the
 * caller decides what to do with non-200 responses and must destroy `body`.
 */
export async function openStream(url, {
  lookup = createSafeLookup(),
  headers = {},
  signal,
  maxRedirects = 3,
} = {}) {
  let target = url;
  for (let hop = 0; ; hop++) {
    const response = await request(target, {
      lookup,
      headers: { 'User-Agent': 'GuzelRadio/1.0', ...headers },
      signal,
    });
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      response.body.destroy();
      if (hop >= maxRedirects) throw new Error('Too many redirects');
      target = new URL(location, target).href;
      continue;
    }
    return response;
  }
}
