import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type SyncMode = "realtime" | "polling";

export type Workspace = {
  hash: string;
  name: string;
  sync_mode: SyncMode;
  created_at: string;
  updated_at: string;
  preview_url: string | null;
  deleted_at?: string;
  purge_at?: string;
};

export type SceneAppState = { viewBackgroundColor?: string };

export type SceneResponse = {
  name: string;
  sync_mode: SyncMode;
  version: number;
  unchanged?: true;
  elements?: ExcalidrawElement[];
  appState?: SceneAppState;
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** The hash in the current URL (`/{hash}`). */
export const pageHash = decodeURIComponent(location.pathname.split("/")[1] ?? "");

export const resolvePage = (hash: string) =>
  request<{ page: "admin" | "workspace" }>(`/api/resolve/${encodeURIComponent(hash)}`);

export function adminApi(adminHash: string) {
  const base = `/api/admin/${adminHash}`;
  return {
    list: () => request<{ workspaces: Workspace[] }>(`${base}/workspaces`).then((r) => r.workspaces),
    create: () => request<{ workspace: Workspace }>(`${base}/workspaces`, { method: "POST" }).then((r) => r.workspace),
    update: (hash: string, patch: { name?: string; sync_mode?: SyncMode }) =>
      request<{ workspace: Workspace }>(`${base}/workspaces/${hash}`, json("PATCH", patch)).then((r) => r.workspace),
    remove: (hash: string) => request<void>(`${base}/workspaces/${hash}`, { method: "DELETE" }),
    trash: () => request<{ workspaces: Workspace[] }>(`${base}/trash`).then((r) => r.workspaces),
    restore: (hash: string) =>
      request<{ workspace: Workspace }>(`${base}/trash/${hash}/restore`, { method: "POST" }).then((r) => r.workspace),
    purge: (hash: string) => request<void>(`${base}/trash/${hash}`, { method: "DELETE" }),
  };
}

export function workspaceApi(hash: string) {
  const base = `/api/w/${hash}`;
  return {
    sceneUrl: `${base}/scene`,
    getScene: (since?: number) =>
      request<SceneResponse>(`${base}/scene${since === undefined ? "" : `?since=${since}`}`),
    putScene: (elements: readonly ExcalidrawElement[], appState: SceneAppState) =>
      request<SceneResponse>(`${base}/scene`, json("PUT", { elements, appState })),
    putPreview: (blob: Blob) =>
      request<void>(`${base}/preview`, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob }),
    deletePreview: () => request<void>(`${base}/preview`, { method: "DELETE" }),
    putFile: (id: string, blob: Blob) =>
      request<void>(`${base}/files/${id}`, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob }),
    getFile: async (id: string) => {
      const res = await fetch(`${base}/files/${id}`);
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return res.blob();
    },
  };
}

export type WorkspaceApi = ReturnType<typeof workspaceApi>;
