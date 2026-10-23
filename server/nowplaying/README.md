# Web player backend: now playing, HTTPS stream relay, play stats

A small Node service with these endpoints for the web player:

- **`/api/nowplaying`**: the current track. Browsers can't read a stream's
  in-band (ICY) metadata: it needs an `Icy-MetaData: 1` request header most
  stream servers don't allow from browsers, and the metadata is mixed into
  the audio bytes.
- **`/api/stream`**: an HTTPS relay for HTTP-only stations. Browsers refuse to
  play `http://` audio on the `https://` site (mixed content). The Android app
  isn't affected, which is why those stations work there.
- **`/api/plays`**: play counts from Guzel Radio's own listeners, for the
  "Most Played" tab (today / this week / all time), and per listener country,
  for the "Listeners" tab. Radio Browser only exposes clicks for the last 24
  hours.

```
GET /api/nowplaying?uuid=<Radio Browser station uuid>

200 { "uuid": "...", "artist": "Tarkan", "title": "Şımarık", "raw": "Tarkan - Şımarık", "fetchedAt": "..." }
    artist/title are null when the station sends no track info
400 invalid uuid · 404 unknown station · 502 Radio Browser unreachable

GET /api/stream?uuid=<Radio Browser station uuid>

200 the station's audio, relayed (only for stations whose URL is http://)
302 redirect to the station's own URL if it already serves https://
400 invalid uuid · 404 unknown station · 415 playlist / non-audio
429 >3 streams from one client · 502 station unreachable · 503 relay full

POST /api/plays?uuid=<Radio Browser station uuid>

204 counted (at most once per listener IP per station every 30 min)
    the listener's country is taken from the X-Country request header

GET /api/plays/top?period=day|week|all&limit=50

200 { "period": "day", "stations": [{ "uuid": "...", "plays": 12 }] }
    day = rolling 24 h, week = rolling 7 days, all = since the service started counting

GET /api/plays/countries?period=day|week|all

200 { "period": "day", "countries": [{ "country": "TR", "plays": 31 }, { "country": "XX", "plays": 2 }] }
    ISO 3166 alpha-2 codes; "XX" = unknown (no header, Tor, or not via Cloudflare)
```

**Listener countries.** The backend does no IP geolocation itself. Cloudflare
sends each request's country in `CF-IPCountry`, and nginx passes it on as
`X-Country`, only for requests that really came through Cloudflare (see the
nginx config below), so it can't be forged by connecting to the origin
directly. Only per-country totals are stored; listener addresses are kept in
memory for the duplicate check and never written to disk.

**Play stats storage.** Counts live in memory and are written to a small JSON
file every minute and on shutdown, via a temp file and rename, so a crash
can't leave a half-written file. The file goes in systemd's
`StateDirectory=` (`/var/lib/radio-nowplaying/plays.json`), or wherever
`PLAYS_FILE` points. A corrupt file is moved aside, not overwritten.
Duplicate plays are detected by `X-Real-IP`, so nginx must pass the real
client address (behind Cloudflare: `real_ip_header CF-Connecting-IP`).

**Relay bandwidth.** Each relayed listener costs the station's bitrate twice,
in and out: about 56 MB/hour each way at 128 kbps. Only HTTP-only stations use
it. Streams are capped at `RELAY_MAX_STREAMS` overall and `RELAY_MAX_PER_CLIENT`
per listener IP. A relay ends after 30 s without data from the station, or
after 6 hours.

**Old SHOUTcast servers.** Many HTTP-only stations run SHOUTcast v1, which
answers `ICY 200 OK` instead of `HTTP/1.1 200 OK`. Node's HTTP client rejects
that, so the service opens streams with its own small client
(`stream-client.mjs`). Both endpoints, including track titles, work with these
servers.

- **No dependencies.** Plain Node 20+.
- **Takes a station uuid, not a URL.** The stream URL is looked up on Radio Browser,
  and connections to private, loopback and link-local addresses are refused,
  including on redirects. That stops either endpoint from being used to reach
  your internal network or to relay arbitrary URLs.
- **Cheap.** Each lookup reads only the first metadata block, about 16–64 KB, then
  disconnects. Results are cached for 15 s per station, so listeners on the same
  station share one upstream request. At most 20 stream connections run at once.

## Run

```bash
cd server/nowplaying
npm test            # unit + local-stream tests
npm start           # listens on 127.0.0.1:3100
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | Listen port |
| `HOST` | `127.0.0.1` | Listen address (keep it local; nginx fronts it) |
| `RELAY_MAX_STREAMS` | `50` | Concurrent relayed streams, all listeners |
| `RELAY_MAX_PER_CLIENT` | `3` | Concurrent relayed streams per listener IP (from `X-Real-IP`) |
| `PLAYS_FILE` | `$STATE_DIRECTORY/plays.json` | Where play counts are saved; unset with no StateDirectory = not persisted |
| `ALLOW_PRIVATE_NETWORKS` | unset | `1` disables the private-address block (local testing only) |

## Deploy next to the site

### 1. systemd unit

Save as `/etc/systemd/system/radio-nowplaying.service`. Adjust the user and path.

```ini
[Unit]
Description=Guzel Radio now-playing endpoint
After=network-online.target

[Service]
WorkingDirectory=/opt/radio-nowplaying
ExecStart=/usr/bin/node server.mjs
Environment=PORT=3100
Restart=on-failure
User=www-data
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
# Writable /var/lib/radio-nowplaying for play stats (exported as STATE_DIRECTORY)
StateDirectory=radio-nowplaying

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /opt/radio-nowplaying
sudo cp server/nowplaying/*.mjs server/nowplaying/package.json /opt/radio-nowplaying/
sudo rm -f /opt/radio-nowplaying/*.test.mjs
sudo systemctl daemon-reload && sudo systemctl enable --now radio-nowplaying
curl "http://127.0.0.1:3100/api/nowplaying?uuid=9617a958-0601-11e8-ae97-52543be04c81"
```

### 2. nginx

Add this inside the `radio.recepguzel.com` server block. Put it **before** any SPA
fallback (`try_files ... /index.html`), so the request isn't answered with the
HTML page. It's a longer prefix than an existing `/api/` location, so nginx
picks it over that one.

```nginx
# in the http {} block
limit_req_zone $binary_remote_addr zone=nowplaying:10m rate=30r/m;

# Listener country for /api/plays: Cloudflare's CF-IPCountry, but only when the
# connection really came from Cloudflare ($realip_remote_addr is the peer
# before real_ip rewrote $remote_addr). The .geo file lists Cloudflare's ranges
# (https://www.cloudflare.com/ips/), one "<cidr> 1;" per line.
geo $realip_remote_addr $via_cloudflare {
    default 0;
    include /etc/nginx/snippets/cloudflare-ips.geo;
}
map $via_cloudflare $listener_country {
    default "";
    1       $http_cf_ipcountry;
}

# in the server {} block (behind Cloudflare, restore the real client address
# first: set_real_ip_from <Cloudflare ranges>; real_ip_header CF-Connecting-IP;)
location = /api/nowplaying {
    limit_req zone=nowplaying burst=10 nodelay;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 15s;
}

# Play stats: POST /api/plays, GET /api/plays/top and /api/plays/countries
location ^~ /api/plays {
    limit_req zone=nowplaying burst=10 nodelay;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Country $listener_country;   # empty = not sent = unknown
    proxy_read_timeout 15s;
}

# HTTPS relay for HTTP-only stations: long-lived, unbuffered.
location = /api/stream {
    limit_req zone=nowplaying burst=10 nodelay;
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;   # used for the per-listener cap
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 60s;    # max gap between chunks, not total length
    proxy_send_timeout 60s;
    gzip off;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The relay's `limit_req` only limits how often streams are *started*; the
service's own caps limit how many run at once.

The web player polls every 20 s while a station is playing and the tab is
visible. If the endpoint is missing (for example the request gets the SPA's
HTML), the player quietly hides track info instead of showing errors.
