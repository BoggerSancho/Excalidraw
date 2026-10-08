import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SyncMode, WorkspaceApi } from "../api";
import type { FileSync } from "./files";
import type { PreviewUploader } from "./preview";
import type { SceneTracker } from "./tracker";

export type SyncStatus = "connecting" | "live" | "saving" | "saved" | "reconnecting" | "offline";

export type SyncContext = {
  hash: string;
  api: ExcalidrawImperativeAPI;
  http: WorkspaceApi;
  tracker: SceneTracker;
  files: FileSync;
  preview: PreviewUploader;
  onStatus: (status: SyncStatus) => void;
  onPeers: (count: number) => void;
  onModeChange: (mode: SyncMode) => void;
  onGone: () => void;
};

export type PointerPayload = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "down" | "up";
};

export interface SyncController {
  onLocalChange(): void;
  onPointer(payload: PointerPayload): void;
  setUsername(name: string): void;
  /** Sends pending changes as soon as possible (best effort on page unload). */
  flush(): void;
  dispose(): void;
}
