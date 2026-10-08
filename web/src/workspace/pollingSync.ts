import { ApiError, type SceneResponse } from "../api";
import type { SyncContext, SyncController } from "./types";

const SAVE_IDLE_MS = 1500;
const SAVE_MAX_WAIT_MS = 10_000;
const POLL_INTERVAL_MS = 5000;
const RETRY_MS = 5000;

/** Fallback sync over plain HTTP: debounced saves plus polling for other people's changes. */
export class PollingSync implements SyncController {
  private readonly ctx: SyncContext;
  private version: number;
  private saveTimer: number | null = null;
  private firstPendingAt: number | null = null;
  private inflight = false;
  private disposed = false;
  private readonly pollTimer: number;

  constructor(ctx: SyncContext, version: number) {
    this.ctx = ctx;
    this.version = version;
    ctx.onPeers(0);
    ctx.onStatus(ctx.tracker.pending() ? "saving" : "saved");
    this.pollTimer = window.setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    if (ctx.tracker.pending()) this.scheduleSave(0);
  }

  onLocalChange() {
    this.ctx.files.uploadNew();
    if (!this.ctx.tracker.pending()) return;
    this.ctx.onStatus("saving");
    this.firstPendingAt ??= Date.now();
    const waited = Date.now() - this.firstPendingAt;
    this.scheduleSave(Math.max(0, Math.min(SAVE_IDLE_MS, SAVE_MAX_WAIT_MS - waited)));
  }

  private scheduleSave(delay: number) {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }

  private async save() {
    if (this.inflight || this.disposed) return;
    const pending = this.ctx.tracker.pending();
    if (!pending) {
      this.ctx.onStatus("saved");
      return;
    }
    this.inflight = true;
    this.firstPendingAt = null;
    try {
      const res = await this.ctx.http.putScene(pending.elements, pending.appState);
      this.ctx.preview.schedule();
      this.applyResponse(res);
    } catch (err) {
      this.handleError(err);
    } finally {
      this.inflight = false;
    }
    if (this.disposed) return;
    if (this.ctx.tracker.pending()) this.scheduleSave(SAVE_IDLE_MS);
    else this.ctx.onStatus("saved");
  }

  private async poll() {
    if (this.inflight || this.disposed || document.visibilityState !== "visible") return;
    this.inflight = true;
    try {
      this.applyResponse(await this.ctx.http.getScene(this.version));
      if (!this.ctx.tracker.pending()) this.ctx.onStatus("saved");
    } catch (err) {
      this.handleError(err);
    } finally {
      this.inflight = false;
    }
  }

  private applyResponse(res: SceneResponse) {
    if (this.disposed) return;
    if (!res.unchanged && res.elements) {
      this.ctx.tracker.applyRemote(res.elements, res.appState, true);
      this.ctx.files.ensureLoaded();
    }
    this.version = res.version;
    if (res.sync_mode !== "polling") this.ctx.onModeChange(res.sync_mode);
  }

  private handleError(err: unknown) {
    if (this.disposed) return;
    if (err instanceof ApiError && err.status === 404) {
      this.ctx.onGone();
      return;
    }
    this.ctx.onStatus("offline");
    if (this.ctx.tracker.pending()) this.scheduleSave(RETRY_MS);
  }

  onPointer() {}
  setUsername() {}

  flush() {
    const pending = this.ctx.tracker.pending();
    if (!pending) return;
    // keepalive lets the request outlive the page; browsers cap such bodies at ~64 KB.
    fetch(this.ctx.http.sceneUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending),
      keepalive: true,
    }).catch(() => {});
    this.ctx.tracker.markSent(pending);
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.pollTimer);
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    const pending = this.ctx.tracker.pending();
    if (pending) {
      // Hand-off to the other transport: it will resend anything this request misses.
      void this.ctx.http.putScene(pending.elements, pending.appState).catch(() => {});
    }
  }
}
