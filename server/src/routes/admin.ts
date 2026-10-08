import fs from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import { getAdminHash, isAdminHash } from "../admin-hash.ts";
import {
  db,
  findWorkspace,
  getSetting,
  nowIso,
  previewPath,
  setSetting,
  transaction,
  type SyncMode,
  type WorkspaceRow,
} from "../db.ts";
import { newHash } from "../hash.ts";
import { ipOf, missLimiter } from "../limiter.ts";
import { evictScene } from "../realtime/scenes.ts";
import { notifyGone, notifyModeChanged } from "../realtime/socket.ts";
import { purgeAt, purgeWorkspace } from "../trash.ts";

const COLUMNS = "id, hash, name, version, sync_mode, has_preview, created_at, updated_at, deleted_at";
type ListRow = Omit<WorkspaceRow, "scene_json">;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function previewUrl(row: ListRow) {
  if (!row.has_preview) return null;
  let stamp = row.version;
  try {
    stamp = Math.floor(fs.statSync(previewPath(row.hash)).mtimeMs);
  } catch {
    return null;
  }
  return `/api/admin/${getAdminHash()}/workspaces/${row.hash}/preview?v=${stamp}`;
}

function toDto(row: ListRow) {
  return {
    hash: row.hash,
    name: row.name,
    sync_mode: row.sync_mode,
    created_at: row.created_at,
    updated_at: row.updated_at,
    preview_url: previewUrl(row),
    ...(row.deleted_at ? { deleted_at: row.deleted_at, purge_at: purgeAt(row.deleted_at) } : {}),
  };
}

const notFound = { error: "not_found" };

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const ip = ipOf(req.raw);
    const { adminHash } = req.params as { adminHash: string };
    if (missLimiter.isBlocked(ip)) return reply.code(429).send({ error: "rate_limited" });
    if (!isAdminHash(adminHash)) {
      missLimiter.hit(ip);
      return reply.code(404).send(notFound);
    }
  });

  app.get("/workspaces", async (req) => {
    const { sort = "updated", order } = req.query as { sort?: string; order?: string };
    const rows = db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE deleted_at IS NULL`).all() as ListRow[];
    const byName = sort === "name";
    const dir = (order ?? (byName ? "asc" : "desc")) === "asc" ? 1 : -1;
    rows.sort((a, b) =>
      dir * (byName ? collator.compare(a.name, b.name) : a.updated_at.localeCompare(b.updated_at)),
    );
    return { workspaces: rows.map(toDto) };
  });

  app.post("/workspaces", async (_req, reply) => {
    const row = transaction(() => {
      const n = Number(getSetting("next_workspace_number") ?? 1);
      let hash = newHash();
      while (findWorkspace(hash) || hash === getAdminHash()) hash = newHash();
      const now = nowIso();
      db.prepare(
        "INSERT INTO workspaces (hash, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).run(hash, `Workspace ${n}`, now, now);
      setSetting("next_workspace_number", String(n + 1));
      return db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE hash = ?`).get(hash) as ListRow;
    });
    return reply.code(201).send({ workspace: toDto(row) });
  });

  app.patch("/workspaces/:wsHash", async (req, reply) => {
    const { wsHash } = req.params as { wsHash: string };
    const body = (req.body ?? {}) as { name?: unknown; sync_mode?: unknown };
    const row = findWorkspace(wsHash);
    if (!row || row.deleted_at) return reply.code(404).send(notFound);

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 100) {
        return reply.code(400).send({ error: "Name must be 1-100 characters" });
      }
      db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), row.id);
    }
    if (body.sync_mode !== undefined) {
      if (body.sync_mode !== "realtime" && body.sync_mode !== "polling") {
        return reply.code(400).send({ error: "sync_mode must be realtime or polling" });
      }
      const mode = body.sync_mode as SyncMode;
      db.prepare("UPDATE workspaces SET sync_mode = ? WHERE id = ?").run(mode, row.id);
      if (mode !== row.sync_mode) notifyModeChanged(row.hash, mode);
    }
    const updated = db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE id = ?`).get(row.id) as ListRow;
    return { workspace: toDto(updated) };
  });

  app.delete("/workspaces/:wsHash", async (req, reply) => {
    const { wsHash } = req.params as { wsHash: string };
    const row = findWorkspace(wsHash);
    if (!row || row.deleted_at) return reply.code(404).send(notFound);
    evictScene(row.hash);
    db.prepare("UPDATE workspaces SET deleted_at = ? WHERE id = ?").run(nowIso(), row.id);
    notifyGone(row.hash);
    return reply.code(204).send();
  });

  app.get("/workspaces/:wsHash/preview", async (req, reply) => {
    const { wsHash } = req.params as { wsHash: string };
    const row = findWorkspace(wsHash);
    if (!row?.has_preview || !fs.existsSync(previewPath(row.hash))) return reply.code(404).send(notFound);
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.type("image/webp").send(fs.createReadStream(previewPath(row.hash)));
  });

  app.get("/trash", async () => {
    const rows = db
      .prepare(`SELECT ${COLUMNS} FROM workspaces WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
      .all() as ListRow[];
    return { workspaces: rows.map(toDto) };
  });

  app.post("/trash/:wsHash/restore", async (req, reply) => {
    const { wsHash } = req.params as { wsHash: string };
    const row = findWorkspace(wsHash);
    if (!row?.deleted_at) return reply.code(404).send(notFound);
    db.prepare("UPDATE workspaces SET deleted_at = NULL WHERE id = ?").run(row.id);
    const updated = db.prepare(`SELECT ${COLUMNS} FROM workspaces WHERE id = ?`).get(row.id) as ListRow;
    return { workspace: toDto(updated) };
  });

  app.delete("/trash/:wsHash", async (req, reply) => {
    const { wsHash } = req.params as { wsHash: string };
    const row = findWorkspace(wsHash);
    if (!row?.deleted_at) return reply.code(404).send(notFound);
    purgeWorkspace(row);
    return reply.code(204).send();
  });
};
