# Now-playing endpoint

Browsers can't read a radio stream's in-band "now playing" (ICY) metadata: it
needs an `Icy-MetaData: 1` request header that most stream servers don't allow
from browsers, and the metadata is mixed into the audio bytes. This small
service reads it server-side for the web player.

```
GET /api/nowplaying?uuid=<Radio Browser station uuid>

200 { "uuid": "...", "artist": "Tarkan", "title": "Şımarık", "raw": "Tarkan - Şımarık", "fetchedAt": "..." }
    artist/title are null when the station sends no track info
400 invalid uuid · 404 unknown station · 502 Radio Browser unreachable
```

- **No dependencies.** Plain Node 20+.
- **Takes a station uuid, not a URL.** The stream URL is looked up on Radio Browser,
  and connections to private, loopback and link-local addresses are refused,
  including on redirects. That stops the endpoint from being used to reach your
  internal network.
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

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /opt/radio-nowplaying
sudo cp server/nowplaying/{server,nowplaying,icy}.mjs server/nowplaying/package.json /opt/radio-nowplaying/
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

# in the server {} block
location = /api/nowplaying {
    limit_req zone=nowplaying burst=10 nodelay;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 15s;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The web player polls every 20 s while a station is playing and the tab is
visible. If the endpoint is missing (for example the request gets the SPA's
HTML), the player quietly hides track info instead of showing errors.
