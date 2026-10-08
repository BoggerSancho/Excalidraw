import fs from "node:fs";
import { config } from "./config.ts";
import { db, filesDir, previewPath, type WorkspaceRow } from "./db.ts";
import { evictScene } from "./realtime/scenes.ts";

export function purgeWorkspace(row: Pick<WorkspaceRow, "id" | "hash">) {
  evictScene(row.hash);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(row.id);
  fs.rmSync(previewPath(row.hash), { force: true });
  fs.rmSync(filesDir(row.hash), { recursive: true, force: true });
}

export const purgeAt = (deletedAt: string) =>
  new Date(new Date(deletedAt).getTime() + config.trashRetentionDays * 86_400_000).toISOString();

export function purgeExpired() {
  const cutoff = new Date(Date.now() - config.trashRetentionDays * 86_400_000).toISOString();
  const rows = db
    .prepare("SELECT id, hash FROM workspaces WHERE deleted_at IS NOT NULL AND deleted_at < ?")
    .all(cutoff) as Pick<WorkspaceRow, "id" | "hash">[];
  rows.forEach(purgeWorkspace);
  return rows.length;
}
