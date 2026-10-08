import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";

fs.mkdirSync(path.join(config.dataDir, "previews"), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "files"), { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "db.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hash        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  scene_json  TEXT    NOT NULL DEFAULT '{"elements":[],"appState":{}}',
  version     INTEGER NOT NULL DEFAULT 0,
  sync_mode   TEXT    NOT NULL DEFAULT 'realtime',
  has_preview INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS files (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id      TEXT    NOT NULL,
  mime_type    TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (workspace_id, file_id)
);
`);

export type SyncMode = "realtime" | "polling";

export type WorkspaceRow = {
  id: number;
  hash: string;
  name: string;
  scene_json: string;
  version: number;
  sync_mode: SyncMode;
  has_preview: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export const nowIso = () => new Date().toISOString();

export function getSetting(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function findWorkspace(hash: string): WorkspaceRow | undefined {
  return db.prepare("SELECT * FROM workspaces WHERE hash = ?").get(hash) as WorkspaceRow | undefined;
}

export function findActiveWorkspace(hash: string): WorkspaceRow | undefined {
  const row = findWorkspace(hash);
  return row && row.deleted_at === null ? row : undefined;
}

export const previewPath = (hash: string) => path.join(config.dataDir, "previews", `${hash}.webp`);
export const filesDir = (hash: string) => path.join(config.dataDir, "files", hash);
