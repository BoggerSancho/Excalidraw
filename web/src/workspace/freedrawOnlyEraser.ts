import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { findExcalidrawApp } from "./reactInternals";

type ExcalidrawApp = {
  elementsPendingErasure: Set<string>;
  scene: { getNonDeletedElementsMap: () => Map<string, ExcalidrawElement> };
};

/**
 * Limits the eraser to freehand drawings, so text, images, shapes and the rest can only be
 * deleted by selecting them. Every path of the eraser (drag, click, group members, text in
 * containers) collects ids in `elementsPendingErasure` before deleting them, so that set is
 * swapped for one that refuses everything else. Returns a function that undoes the patch.
 */
export function restrictEraserToFreedraw(root: HTMLElement): () => void {
  const app = findExcalidrawApp(root) as ExcalidrawApp | null;
  if (!app || !(app.elementsPendingErasure instanceof Set)) {
    console.warn("Couldn't find the Excalidraw app; the eraser can delete any element.");
    return () => {};
  }
  const isFreedraw = (id: string) => app.scene.getNonDeletedElementsMap().get(id)?.type === "freedraw";

  class FreedrawOnlySet extends Set<string> {
    add(id: string) {
      return isFreedraw(id) ? super.add(id) : this;
    }
  }

  let pending: Set<string> = new FreedrawOnlySet(app.elementsPendingErasure);
  Object.defineProperty(app, "elementsPendingErasure", {
    configurable: true,
    get: () => pending,
    set: (value: Set<string>) => {
      pending = new FreedrawOnlySet(value);
    },
  });
  return () => {
    Object.defineProperty(app, "elementsPendingErasure", {
      configurable: true,
      writable: true,
      value: new Set(pending),
    });
  };
}
