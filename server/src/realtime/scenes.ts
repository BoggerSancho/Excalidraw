// In-memory scene cache shared by the HTTP (polling) and Socket.IO (real-time) paths.
// The cache is the source of truth while a workspace is open; it is written to SQLite
// at most every `persistIntervalMs` and when the workspace is flushed or evicted.
import { config } from "../config.ts";
import { db, findActiveWorkspace, nowIso } from "../db.ts";

export type SceneElement = {
  id: string;
  version: number;
  versionNonce: number;
  index?: string | null;
  [key: string]: unknown;
};

export type SceneAppState = { viewBackgroundColor?: string };

type Scene = {
  workspaceId: number;
  hash: string;
  elements: Map<string, SceneElement>;
  appState: SceneAppState;
  version: number;
  updatedAt: string;
  dirty: boolean;
  timer: NodeJS.Timeout | null;
  clients: number;
  lastAccess: number;
};

const scenes = new Map<string, Scene>();
const IDLE_EVICT_MS = 10 * 60 * 1000;
const MAX_ELEMENTS = 50_000;

export function getScene(hash: string): Scene | undefined {
  let scene = scenes.get(hash);
  if (!scene) {
    const row = findActiveWorkspace(hash);
    if (!row) return undefined;
    const parsed = JSON.parse(row.scene_json) as { elements?: SceneElement[]; appState?: SceneAppState };
    scene = {
      workspaceId: row.id,
      hash,
      elements: new Map((parsed.elements ?? []).map((el) => [el.id, el])),
      appState: parsed.appState ?? {},
      version: row.version,
      updatedAt: row.updated_at,
      dirty: false,
      timer: null,
      clients: 0,
      lastAccess: Date.now(),
    };
    scenes.set(hash, scene);
  }
  scene.lastAccess = Date.now();
  return scene;
}

export function sceneElements(scene: Scene): SceneElement[] {
  return [...scene.elements.values()].sort((a, b) => {
    const ai = a.index ?? "";
    const bi = b.index ?? "";
    return ai < bi ? -1 : ai > bi ? 1 : a.id < b.id ? -1 : 1;
  });
}

export function snapshot(scene: Scene) {
  return { elements: sceneElements(scene), appState: scene.appState, version: scene.version };
}

export function isValidElements(value: unknown): value is SceneElement[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ELEMENTS &&
    value.every(
      (el) =>
        el !== null &&
        typeof el === "object" &&
        typeof el.id === "string" &&
        el.id.length > 0 &&
        el.id.length <= 64 &&
        Number.isFinite(el.version) &&
        Number.isFinite(el.versionNonce),
    )
  );
}

// Same rule as Excalidraw's reconcileElements: higher version wins; on a tie the lower
// versionNonce wins, so every peer converges on the same element.
function incomingWins(current: SceneElement | undefined, incoming: SceneElement) {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return incoming.versionNonce < current.versionNonce;
}

/** Merges elements into the scene and returns the ones that were accepted. */
export function mergeIntoScene(scene: Scene, incoming: SceneElement[], appState?: unknown): SceneElement[] {
  const accepted: SceneElement[] = [];
  for (const el of incoming) {
    if (incomingWins(scene.elements.get(el.id), el)) {
      scene.elements.set(el.id, el);
      accepted.push(el);
    }
  }
  let appStateChanged = false;
  const bg = (appState as SceneAppState | undefined)?.viewBackgroundColor;
  if (typeof bg === "string" && bg.length <= 64 && bg !== scene.appState.viewBackgroundColor) {
    scene.appState = { ...scene.appState, viewBackgroundColor: bg };
    appStateChanged = true;
  }
  if (accepted.length > 0 || appStateChanged) {
    scene.version += 1;
    scene.updatedAt = nowIso();
    scene.dirty = true;
    schedulePersist(scene);
  }
  return accepted;
}

function schedulePersist(scene: Scene) {
  if (scene.timer) return;
  scene.timer = setTimeout(() => {
    scene.timer = null;
    persist(scene);
  }, config.persistIntervalMs);
}

function persist(scene: Scene) {
  if (!scene.dirty) return;
  const json = JSON.stringify({ elements: sceneElements(scene), appState: scene.appState });
  db.prepare(
    "UPDATE workspaces SET scene_json = ?, version = ?, updated_at = MAX(updated_at, ?) WHERE id = ?",
  ).run(json, scene.version, scene.updatedAt, scene.workspaceId);
  scene.dirty = false;
}

export function flushScene(hash: string) {
  const scene = scenes.get(hash);
  if (!scene) return;
  if (scene.timer) clearTimeout(scene.timer);
  scene.timer = null;
  persist(scene);
}

export function evictScene(hash: string) {
  flushScene(hash);
  scenes.delete(hash);
}

export function flushAll() {
  for (const hash of scenes.keys()) flushScene(hash);
}

export function changeClients(hash: string, delta: number) {
  const scene = scenes.get(hash);
  if (!scene) return;
  scene.clients = Math.max(0, scene.clients + delta);
  if (scene.clients === 0) flushScene(hash);
}

setInterval(() => {
  const now = Date.now();
  for (const scene of scenes.values()) {
    if (scene.clients === 0 && now - scene.lastAccess > IDLE_EVICT_MS) evictScene(scene.hash);
  }
}, 60_000).unref();
