# Excalidraw Workspaces

A self-hosted wrapper around [Excalidraw](https://github.com/excalidraw/excalidraw). One secret admin link manages workspaces; each workspace has its own secret link that opens a normal Excalidraw canvas, saved on the server and edited together in real time.

- `/{admin_hash}`: admin panel. Create, open, rename, copy links, sort by name or last update, switch a workspace between real-time and polling sync, and move workspaces to a trash that is purged after 30 days.
- `/{workspace_hash}`: the Excalidraw editor. Anyone with the link can edit it.

Links never change. Treat them like passwords, and serve the app only over HTTPS.

## Run with Podman

With plain Podman (nothing else to install):

```sh
podman build -t localhost/excalidraw-workspaces:latest -f Containerfile .
podman run -d --name excalidraw-workspaces --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v excalidraw-data:/data -e TRUST_PROXY=true \
  localhost/excalidraw-workspaces:latest
podman exec excalidraw-workspaces npm run -s admin-link -w server   # prints /<admin_hash>
```

Or with compose (`sudo pacman -S podman-compose` on Arch/CachyOS): `podman-compose up -d --build`.

The app listens on `127.0.0.1:3000`. Put a reverse proxy with HTTPS in front of it: see [deploy/Caddyfile](deploy/Caddyfile) or [deploy/nginx.conf](deploy/nginx.conf). The proxy must pass WebSocket upgrades.

To start the app on boot with systemd instead of compose, build the image and use the Quadlet unit in [deploy/excalidraw-workspaces.container](deploy/excalidraw-workspaces.container). The instructions are in the file's header.

All data lives in the `excalidraw-data` volume (`db.sqlite`, previews, pasted images). To back it up:

```sh
podman volume export excalidraw-data -o excalidraw-backup.tar
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_HASH` | generated on first start | Fixed admin hash (10–16 chars, `0-9A-Za-z`). If unset, one is generated, stored and printed once to the logs. |
| `HASH_LENGTH` | `12` | Length of newly generated hashes (10–16). |
| `TRASH_RETENTION_DAYS` | `30` | Days a workspace stays in the trash before it is deleted for good. |
| `TRUST_PROXY` | `false` | Read the client IP from `X-Forwarded-For` for rate limiting. Enable it only when the port is reachable solely through your proxy (the compose file binds to localhost and enables it). |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address. |
| `DATA_DIR` | `./data` (`/data` in the container) | Database and file storage. |

## Development

Requires Node.js 24 or newer. The server runs TypeScript directly and uses the built-in `node:sqlite`.

```sh
npm install
npm run dev -w server     # API + WebSocket on :3000 (creates ./server/data)
npm run dev -w web        # Vite on :5173, proxies /api and /socket.io to :3000
npm run typecheck
```

The admin link is printed when the server starts for the first time, and `npm run admin-link -w server` prints it again later. In development, open it on port 5173.

## How sync works

- **Real-time (default):** Socket.IO room per workspace. Clients send only changed elements, and the server merges them using Excalidraw's rule (higher element `version` wins), relays them to the others along with cursors, and writes to SQLite at most every 2 s and when the last person leaves.
- **Polling (fallback):** for networks that block WebSockets. Changes are saved over HTTP about 1.5 s after you stop drawing, and other people's changes are fetched every 5 s.
- The admin panel switches a workspace between the two. Open tabs switch over without reloading and without losing edits, and both modes can be active at once during the switch.

See [plan.md](plan.md) for the full design.
