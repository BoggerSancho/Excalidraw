import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { WorkspaceApi } from "../api";

const blobToDataURL = (blob: Blob) =>
  new Promise<DataURL>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Uploads images pasted locally and downloads images other people added. */
export class FileSync {
  private known = new Set<string>();
  private loading = new Set<string>();
  private retryTimer: number | null = null;
  private readonly api: ExcalidrawImperativeAPI;
  private readonly http: WorkspaceApi;

  constructor(api: ExcalidrawImperativeAPI, http: WorkspaceApi) {
    this.api = api;
    this.http = http;
  }

  uploadNew() {
    for (const file of Object.values(this.api.getFiles())) {
      if (this.known.has(file.id)) continue;
      this.known.add(file.id);
      fetch(file.dataURL)
        .then((res) => res.blob())
        .then((blob) => this.http.putFile(file.id, blob))
        .catch(() => this.known.delete(file.id));
    }
  }

  /** Fetches files referenced by image elements that aren't loaded yet. */
  ensureLoaded() {
    const files = this.api.getFiles();
    const missing = new Set<FileId>();
    for (const el of this.api.getSceneElements()) {
      if (el.type === "image" && el.fileId && !files[el.fileId] && !this.loading.has(el.fileId)) missing.add(el.fileId);
    }
    for (const id of missing) {
      this.loading.add(id);
      this.http
        .getFile(id)
        .then(async (blob) => {
          const data: BinaryFileData = {
            id,
            dataURL: await blobToDataURL(blob),
            mimeType: blob.type as BinaryFileData["mimeType"],
            created: Date.now(),
          };
          this.known.add(id);
          this.api.addFiles([data]);
        })
        .catch(() => {
          // The uploader may not have finished yet; try again shortly.
          if (this.retryTimer === null) {
            this.retryTimer = window.setTimeout(() => {
              this.retryTimer = null;
              this.ensureLoaded();
            }, 3000);
          }
        })
        .finally(() => this.loading.delete(id));
    }
  }

  dispose() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
  }
}
