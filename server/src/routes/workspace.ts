import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { db, filesDir, findActiveWorkspace, nowIso, previewPath, type WorkspaceRow } from "../db.ts";
import { isHashShaped } from "../hash.ts";
import { ipOf, missLimiter } from "../limiter.ts";
import { getScene, isValidElements, mergeIntoScene, snapshot } from "../realtime/scenes.ts";
import { broadcastSceneUpdate } from "../realtime/socket.ts";

declare module "fastify" {
  interface FastifyRequest {
    workspace: WorkspaceRow;
  }
}

const FILE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const IMAGE_MIME_RE = /^image\/(png|jpeg|gif|webp|svg\+xml|bmp|x-icon|avif)$/;
const notFound = { error: "not_found" };

export const workspaceRoutes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("workspace", null as unknown as WorkspaceRow);

  app.addHook("onRequest", async (req, reply) => {
    const ip = ipOf(req.raw);
    const { wsHash } = req.params as { wsHash: string };
    if (missLimiter.isBlocked(ip)) return reply.code(429).send({ error: "rate_limited" });
    const row = isHashShaped(wsHash) ? findActiveWorkspace(wsHash) : undefined;
    if (!row) {
      missLimiter.hit(ip);
      return reply.code(404).send(notFound);
    }
    req.workspace = row;
  });

  app.get("/scene", async (req, reply) => {
    const { since } = req.query as { since?: string };
    const ws = req.workspace;
    const scene = getScene(ws.hash);
    if (!scene) return reply.code(404).send(notFound);
    const meta = { name: ws.name, sync_mode: ws.sync_mode, version: scene.version };
    if (since !== undefined && Number(since) === scene.version) return { ...meta, unchanged: true };
    return { ...snapshot(scene), ...meta };
  });

  app.put("/scene", async (req, reply) => {
    const ws = req.workspace;
    const body = (req.body ?? {}) as { elements?: unknown; appState?: unknown };
    if (!isValidElements(body.elements)) return reply.code(400).send({ error: "invalid elements" });
    const scene = getScene(ws.hash);
    if (!scene) return reply.code(404).send(notFound);
    const before = scene.version;
    const accepted = mergeIntoScene(scene, body.elements, body.appState);
    if (scene.version !== before) broadcastSceneUpdate(ws.hash, accepted, scene.appState, scene.version);
    return { ...snapshot(scene), name: ws.name, sync_mode: ws.sync_mode };
  });

  app.put("/preview", async (req, reply) => {
    const body = req.body;
    const type = req.headers["content-type"];
    if (!Buffer.isBuffer(body) || (type !== "image/webp" && type !== "image/png")) {
      return reply.code(400).send({ error: "expected image/webp or image/png body" });
    }
    if (body.length > 2 * 1024 * 1024) return reply.code(413).send({ error: "preview too large" });
    fs.writeFileSync(previewPath(req.workspace.hash), body);
    db.prepare("UPDATE workspaces SET has_preview = 1 WHERE id = ?").run(req.workspace.id);
    return reply.code(204).send();
  });

  app.delete("/preview", async (req, reply) => {
    fs.rmSync(previewPath(req.workspace.hash), { force: true });
    db.prepare("UPDATE workspaces SET has_preview = 0 WHERE id = ?").run(req.workspace.id);
    return reply.code(204).send();
  });

  app.get("/preview", async (req, reply) => {
    const file = previewPath(req.workspace.hash);
    if (!req.workspace.has_preview || !fs.existsSync(file)) return reply.code(404).send(notFound);
    reply.header("Cache-Control", "private, no-cache");
    return reply.type("image/webp").send(fs.createReadStream(file));
  });

  app.put("/files/:fileId", async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    const mime = req.headers["content-type"] ?? "";
    if (!FILE_ID_RE.test(fileId)) return reply.code(400).send({ error: "invalid file id" });
    if (!IMAGE_MIME_RE.test(mime) || !Buffer.isBuffer(req.body)) {
      return reply.code(400).send({ error: "unsupported file type" });
    }
    const dir = filesDir(req.workspace.hash);
    const file = path.join(dir, fileId);
    // Excalidraw file ids are content hashes, so an existing file never needs replacing.
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, req.body);
      db.prepare(
        "INSERT OR IGNORE INTO files (workspace_id, file_id, mime_type, created_at) VALUES (?, ?, ?, ?)",
      ).run(req.workspace.id, fileId, mime, nowIso());
    }
    return reply.code(204).send();
  });

  app.get("/files/:fileId", async (req, reply) => {
    const { fileId } = req.params as { fileId: string };
    if (!FILE_ID_RE.test(fileId)) return reply.code(404).send(notFound);
    const row = db
      .prepare("SELECT mime_type FROM files WHERE workspace_id = ? AND file_id = ?")
      .get(req.workspace.id, fileId) as { mime_type: string } | undefined;
    const file = path.join(filesDir(req.workspace.hash), fileId);
    if (!row || !fs.existsSync(file)) return reply.code(404).send(notFound);
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    // SVGs can carry scripts; never let the browser render them as a document from our origin.
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    return reply.type(row.mime_type).send(fs.createReadStream(file));
  });
};
