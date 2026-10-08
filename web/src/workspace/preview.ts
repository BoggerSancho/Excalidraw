import { exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { WorkspaceApi } from "../api";

const MIN_INTERVAL_MS = 30_000;
const FIRST_DELAY_MS = 5_000;

/** Uploads a small thumbnail for the admin panel after local edits, at most every 30 s. */
export class PreviewUploader {
  private timer: number | null = null;
  private lastUpload = 0;
  private readonly api: ExcalidrawImperativeAPI;
  private readonly http: WorkspaceApi;

  constructor(api: ExcalidrawImperativeAPI, http: WorkspaceApi) {
    this.api = api;
    this.http = http;
  }

  schedule() {
    if (this.timer !== null) return;
    const delay = Math.max(FIRST_DELAY_MS, MIN_INTERVAL_MS - (Date.now() - this.lastUpload));
    this.timer = window.setTimeout(() => void this.upload(), delay);
  }

  private async upload() {
    this.timer = null;
    this.lastUpload = Date.now();
    const elements = this.api.getSceneElements();
    try {
      if (elements.length === 0) {
        await this.http.deletePreview();
        return;
      }
      const blob = await exportToBlob({
        elements,
        appState: { ...this.api.getAppState(), exportBackground: true, exportWithDarkMode: false },
        files: this.api.getFiles(),
        mimeType: "image/webp",
        quality: 0.8,
        maxWidthOrHeight: 400,
        exportPadding: 16,
      });
      await this.http.putPreview(blob);
    } catch (err) {
      console.warn("Preview upload failed", err);
    }
  }

  dispose() {
    if (this.timer !== null) clearTimeout(this.timer);
  }
}
