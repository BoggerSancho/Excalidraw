# Excalidraw Workspaces — Plan

A self-hosted wrapper around the open-source Excalidraw editor. One secret admin link manages a set of workspaces; each workspace has its own secret link that opens a standard Excalidraw canvas whose contents are stored on the host and edited together in real time.

---

## 1. Concepts

| Term | Meaning |
|---|---|
| `hash_code` | Short, unique, URL-safe random ID, 12 characters by default (configurable 10–16). Generated with `nanoid` (alphabet `0-9A-Za-z`, 62 symbols, so 12 chars ≈ 71 bits of entropy). Possession of the link is the only access control. |
| Admin link | `https://<host>/{admin_hash}`: opens the admin panel. |
| Workspace link | `https://<host>/{workspace_hash}`: opens the Excalidraw editor for that workspace. |

Both kinds of link share the route `/{hash_code}`. The server resolves the hash:

1. It matches the admin hash, so the server serves the admin panel.
2. It matches an active workspace hash, so the server serves the editor.
3. It matches nothing, or matches a workspace in the trash, so the server returns a generic 404 that doesn't say whether the hash ever existed.

**Links never change.** Every hash is generated once and kept forever. There is no regenerate or rotate feature, for the admin link or for workspace links. A workspace restored from the trash keeps its original link.

**Admin hash origin:** read from the `ADMIN_HASH` env var. If the variable is unset, the server generates one on first start, stores it in the DB and prints it once to the logs. After that, the stored value is reused on every start.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Editor | `@excalidraw/excalidraw` npm package (React component) | Official embeddable build with full default functionality. You don't need to fork the whole excalidraw.com app. |
| Frontend | React + TypeScript + Vite | Same ecosystem as Excalidraw. |
| Backend | Node.js + TypeScript + Fastify | Lightweight; serves the API, the WebSocket endpoint and the built static frontend. |
| Real-time | Socket.IO (via `fastify-socket.io`) | One room per workspace; handles reconnects and fallbacks. |
| Database | SQLite (`better-sqlite3`) | Single file, zero ops, enough for this scale. |
| File storage | Local disk volume (`/data`) | Holds preview images and embedded image files. |
| Deploy | Podman (rootless) with a `Containerfile` and `podman-compose`, plus an optional Quadlet `.container` unit so systemd starts it on boot; behind a reverse proxy (Caddy or Nginx) with HTTPS and WebSocket upgrade enabled | HTTPS is mandatory because the links are secrets. |

---

## 3. Data model

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
  -- admin_hash
  -- next_workspace_number   (autoincrement counter for default names, starts at 1)
);

CREATE TABLE workspaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hash        TEXT    NOT NULL UNIQUE,      -- workspace hash_code, never changes
  name        TEXT    NOT NULL,
  scene_json  TEXT    NOT NULL DEFAULT '{"elements":[],"appState":{}}',
  version     INTEGER NOT NULL DEFAULT 0,   -- incremented on every save (optimistic concurrency)
  sync_mode   TEXT    NOT NULL DEFAULT 'realtime',  -- 'realtime' | 'polling'
  has_preview INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,             -- ISO-8601 UTC
  updated_at  TEXT    NOT NULL,             -- ISO-8601 UTC; bumped on scene save and rename
  deleted_at  TEXT                          -- NULL = active; set = in trash
);

CREATE TABLE files (                        -- images pasted into a canvas
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id      TEXT    NOT NULL,            -- Excalidraw FileId
  mime_type    TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (workspace_id, file_id)
);
```

Disk layout:

```
/data/
  db.sqlite
  previews/{workspace_hash}.webp
  files/{workspace_hash}/{file_id}
```

### Default names (autoincrement)
- A new workspace is named `Workspace N`, where `N` is read from `settings.next_workspace_number`, which is then incremented in the same transaction.
- The counter only ever goes up. Numbers are never reused, even after a workspace is deleted, restored or purged, so default names never repeat.

### Trash
- **Delete** moves a workspace to the trash by setting `deleted_at`. Its link stops working (404) and live sessions in it are disconnected.
- **Restore** clears `deleted_at`. The workspace comes back with the same name, contents and link.
- **Delete permanently** removes the row, its preview and its files.
- **Auto-purge:** a job runs at startup and then every hour, and permanently deletes workspaces that have been in the trash for more than 30 days (configurable with `TRASH_RETENTION_DAYS`).

---

## 4. HTTP API

### Admin (all routes prefixed with `/api/admin/{admin_hash}`; a wrong hash returns 404)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/workspaces?sort=name\|updated&order=asc\|desc` | List active workspaces: `hash, name, updated_at, sync_mode, preview_url` |
| `POST` | `/workspaces` | Create a workspace with the next default name `Workspace N` |
| `PATCH` | `/workspaces/{ws_hash}` | Update `{ name?, sync_mode? }` |
| `DELETE` | `/workspaces/{ws_hash}` | Move to trash |
| `GET` | `/trash` | List trashed workspaces: `hash, name, deleted_at, purge_at, preview_url` |
| `POST` | `/trash/{ws_hash}/restore` | Restore from trash |
| `DELETE` | `/trash/{ws_hash}` | Delete permanently |

### Workspace (prefixed with `/api/w/{ws_hash}`; trashed workspaces return 404)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/scene` | Return `{ elements, appState, version, name, sync_mode }` |
| `PUT` | `/scene` | Save changed elements (polling mode). The body is `{ elements, appState }`. The server merges per element (higher `version` wins, as in Excalidraw's `reconcileElements`), so there are no conflicts to reject; the response is the full merged scene. |
| `PUT` | `/preview` | Upload a thumbnail (WebP, about 400×300) |
| `GET` | `/preview` | Serve the thumbnail |
| `PUT` | `/files/{file_id}` | Upload an embedded image |
| `GET` | `/files/{file_id}` | Download an embedded image |

### WebSocket (Socket.IO, namespace `/ws`)

| Event | Direction | Payload / purpose |
|---|---|---|
| `join` | client → server | `{ ws_hash }`. Rejected if the hash is unknown, trashed or in polling mode. |
| `scene:init` | server → client | Full current scene and version on join |
| `scene:update` | client → server | Changed elements only (elements whose `version` grew since the last broadcast) |
| `scene:update` | server → other clients | The same changed elements, relayed to the rest of the room |
| `pointer` | both ways | Cursor position, username and colour; relayed, never stored |
| `mode:changed` | server → client | `{ sync_mode }` when the admin switches the mode, so the client switches without a reload |
| `workspace:gone` | server → client | The workspace was moved to the trash; the client shows a "This workspace is no longer available" screen |

### Pages

| Path | Serves |
|---|---|
| `GET /{hash}` | The SPA `index.html`. The server injects `window.__PAGE__ = "admin" \| "workspace"`, or returns 404. |

---

## 5. Admin panel (`/{admin_hash}`)

### Layout
- **Header:** title, a **+ New workspace** button, a sort control and a **Trash (n)** tab.
- **Grid** of square cards (CSS grid, `aspect-ratio: 1`, responsive 2–6 columns). Each card shows:
  - The preview image (or a placeholder for an empty canvas)
  - The name
  - The last update time, formatted in local time (e.g. `2026-10-08 14:32`, with a relative "5 min ago" on hover)
  - A small badge when the workspace is in polling mode, so non-default workspaces stand out
  - A `⋯` menu: **Open**, **Rename**, **Copy link**, **Sync mode**, **Delete**

### Features
1. **Create:** `POST /workspaces`. The name is `Workspace N` from the autoincrement counter. The new card appears at once.
2. **Delete:** a confirmation modal reads *"Move 'Workspace 3' to trash? It will be deleted permanently after 30 days."* with **Cancel** and a red **Move to trash** button. The workspace is moved only after confirmation.
3. **Open:** a click on the card (or **Open** in the menu) opens `/{ws_hash}` in a new tab.
4. **Rename:** inline edit of the name, or a small modal. Enter saves, Esc cancels. The name is trimmed and limited to 1–100 characters.
5. **Cards:** described in the Layout section above.
6. **Sort:** a toggle between **Name** (A→Z, natural order so that "Workspace 10" comes after "Workspace 9") and **Last updated** (newest first). Clicking the active option flips the direction. The choice is saved in `localStorage`.
7. **Sync mode:** a per-workspace switch between **Real-time** (default) and **Polling**. Changing it takes effect immediately for everyone who has the workspace open (see §6).
8. **Trash view:** the same card grid, showing the deletion date and "Deleted permanently in N days" instead of the last update time. Each card has:
   - **Restore**, which moves it back to the main grid with its original link.
   - **Delete permanently**, behind a second confirmation modal: *"Permanently delete 'Workspace 3'? This cannot be undone."*

---

## 6. Workspace editor (`/{ws_hash}`)

- A full-screen `<Excalidraw />` component with default UI and features: tools, library, export, dark mode, and so on.
- **Load:** `GET /scene` feeds `initialData` and tells the client which sync mode to use. Embedded files are fetched and passed to `addFiles`.
- **Embedded images** are uploaded with `PUT /files/{file_id}` in both modes; only element changes go through the socket.

### Real-time mode (default)
- The client joins the workspace's Socket.IO room.
- On `onChange`, the client sends only changed elements (throttled to about every 50–100 ms). Other clients merge them with Excalidraw's `reconcileElements` and call `updateScene`.
- Live cursors and collaborator names come from `onPointerUpdate` and are shown through Excalidraw's built-in `collaborators` support. A display name is asked once and stored in `localStorage`.
- **Persistence:** the server keeps the latest scene for each room in memory, merges incoming updates into it, and writes it to SQLite at most every 2 s and when the last client leaves. The server stays the source of truth.
- **Reconnect:** on disconnect, the badge shows "Reconnecting…" and edits keep queuing locally. After reconnect the client gets `scene:init`, reconciles it with its local elements and sends whatever the server is missing.

### Polling mode (fallback the admin can switch on)
Meant for users whose network or proxy blocks WebSockets, or who see sync problems.
- `onChange` triggers a debounced `PUT /scene` (about 1.5 s idle, and at most every 10 s while drawing continues) with only the changed elements. The client merges the returned scene with `reconcileElements`.
- While the tab is visible, the client polls `GET /scene` every 5 s and merges changes when the version has changed.
- No live cursors.

### Switching modes
- When the admin changes the mode, the server sends `mode:changed` to clients in the room, and those clients switch without a reload. Clients already in polling mode pick up the new mode from their next `GET /scene` response.
- Before switching, the client flushes any pending changes.

### Both modes
- The client strips transient `appState` fields (selection, collaborators, open dialogs) before saving.
- On `beforeunload` or `visibilitychange`, the client flushes pending changes (`fetch(..., { keepalive: true })` in polling mode).
- **Preview:** at most once every 30 s after a change, one client (the most recent editor) calls `exportToBlob({ mimeType: "image/webp", maxWidthOrHeight: 400 })` and sends the result to `PUT /preview`.
- **Status badge** in a corner: "Live · 3 people" / "Saved" / "Saving…" / "Reconnecting…" / "Offline". The tab title shows the workspace name.

---

## 7. Security

- Links are bearer secrets. Serve everything over HTTPS and set `Referrer-Policy: no-referrer` so hashes don't leak to third parties.
- Set `X-Robots-Tag: noindex` and add a `robots.txt` that disallows everything.
- Rate-limit requests per IP to `/{hash}`, `/api/*` and socket `join` (for example, 30 per minute for unknown-hash 404s) to make brute-forcing impractical.
- Compare the admin hash with a constant-time comparison.
- Limit body sizes: about 20 MB per scene and about 10 MB per file; limit socket message size too. Validate MIME types for files and previews.
- No hash ever appears in API responses, except in the admin endpoints.

---

## 8. Project structure

```
/
├─ compose.yml          # podman-compose
├─ Containerfile
├─ server/
│  ├─ src/
│  │  ├─ index.ts          # Fastify bootstrap, static serving, /{hash} routing
│  │  ├─ db.ts             # SQLite connection + migrations
│  │  ├─ hash.ts           # nanoid generator
│  │  ├─ trash.ts          # auto-purge job
│  │  ├─ realtime/
│  │  │  ├─ rooms.ts       # in-memory scene per room, merge, throttled persistence
│  │  │  └─ socket.ts      # Socket.IO events
│  │  ├─ routes/admin.ts
│  │  └─ routes/workspace.ts
│  └─ package.json
└─ web/
   ├─ src/
   │  ├─ main.tsx          # picks AdminPage or WorkspacePage from window.__PAGE__
   │  ├─ admin/
   │  │  ├─ AdminPage.tsx
   │  │  ├─ TrashView.tsx
   │  │  ├─ WorkspaceCard.tsx
   │  │  ├─ ConfirmModal.tsx
   │  │  └─ SortControl.tsx
   │  ├─ workspace/
   │  │  ├─ WorkspacePage.tsx
   │  │  ├─ realtimeSync.ts  # socket client, element diffing, cursors
   │  │  ├─ pollingSync.ts   # debounced save, polling, merge
   │  │  └─ preview.ts
   │  └─ api.ts
   ├─ vite.config.ts
   └─ package.json
```

---

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| 1 | **Skeleton** | Monorepo, Fastify serves the Vite build, SQLite migrations run, admin hash is generated or loaded, and `/{hash}` routing works. |
| 2 | **Admin CRUD** | Create (autoincrement names), list, rename and sort work. Cards render with a placeholder preview. |
| 3 | **Trash** | Delete moves to trash with confirmation; trash view with restore and permanent delete; auto-purge after 30 days; trashed links return 404. |
| 4 | **Editor + persistence (polling mode)** | Excalidraw loads and autosaves to the host, a reload shows the same drawing, embedded images persist, and two tabs converge via polling and per-element merge. |
| 5 | **Real-time mode** | Socket.IO rooms, live element sync and cursors, server-side merge with throttled persistence, reconnect handling. Real-time is the default for new workspaces. |
| 6 | **Sync mode switch** | The admin toggles the mode per workspace; open clients switch live without losing changes. |
| 7 | **Previews** | Thumbnails are generated client-side and appear on admin and trash cards. `updated_at` changes on save. |
| 8 | **Hardening and deploy** | Rate limiting, headers, body and message limits, Podman image built from the `Containerfile`, `compose.yml` and a Quadlet unit with a `/data` volume (`:Z` label for SELinux hosts), reverse-proxy config with WebSocket upgrade, and a backup note (copy `/data`). |
