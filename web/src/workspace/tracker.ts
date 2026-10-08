import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SceneAppState } from "../api";

/**
 * Remembers which version of every element the server is known to have, so we only send
 * what changed. Shared by both transports so switching mode doesn't resend everything.
 */
export class SceneTracker {
  private synced = new Map<string, number>();
  private syncedBackground: string | undefined;
  private readonly api: ExcalidrawImperativeAPI;

  constructor(api: ExcalidrawImperativeAPI) {
    this.api = api;
  }

  /** Elements and app state the server doesn't have yet. */
  pending(): { elements: OrderedExcalidrawElement[]; appState: SceneAppState } | null {
    const elements = this.api
      .getSceneElementsIncludingDeleted()
      .filter((el) => this.synced.get(el.id) !== el.version);
    const background = this.api.getAppState().viewBackgroundColor;
    const backgroundChanged = background !== this.syncedBackground;
    if (elements.length === 0 && !backgroundChanged) return null;
    return { elements, appState: backgroundChanged ? { viewBackgroundColor: background } : {} };
  }

  markSent(sent: { elements: readonly ExcalidrawElement[]; appState: SceneAppState }) {
    for (const el of sent.elements) this.synced.set(el.id, el.version);
    if (sent.appState.viewBackgroundColor !== undefined) this.syncedBackground = sent.appState.viewBackgroundColor;
  }

  /**
   * Merges remote elements into the canvas. With `fullScene`, the remote list is the
   * server's complete state, so our record of what it holds is rebuilt from it; anything
   * local the server lacks then shows up in `pending()` and is resent.
   */
  applyRemote(remote: readonly ExcalidrawElement[], appState: SceneAppState | undefined, fullScene: boolean) {
    if (fullScene) this.synced.clear();
    for (const el of remote) this.synced.set(el.id, el.version);

    if (remote.length > 0) {
      const merged = reconcileElements(
        this.api.getSceneElementsIncludingDeleted(),
        remote as RemoteExcalidrawElement[],
        this.api.getAppState(),
      );
      this.api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    }

    const bg = appState?.viewBackgroundColor;
    if (bg !== undefined) {
      const localChanged = this.api.getAppState().viewBackgroundColor !== this.syncedBackground;
      this.syncedBackground = bg;
      if (!localChanged || fullScene) {
        this.api.updateScene({ appState: { viewBackgroundColor: bg }, captureUpdate: CaptureUpdateAction.NEVER });
      }
    }
  }
}
