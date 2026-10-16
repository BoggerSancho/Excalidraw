import { CaptureUpdateAction, mutateElement, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { findExcalidrawApp } from "./reactInternals";

/** Gap between pictures inserted together, in scene pixels. */
const GAP = 5;

type ImageAction = (opts: { insertOnCanvasDirectly: boolean }) => Promise<void>;

type ExcalidrawApp = {
  state: AppState;
  setState: (state: Partial<AppState>, callback?: () => void) => void;
  onImageAction: ImageAction;
  createImageElement: (opts: { sceneX: number; sceneY: number; addToFrameUnderCursor?: boolean }) => ExcalidrawImageElement;
  insertImageElement: (
    element: ExcalidrawImageElement,
    file: File,
    showCursorImagePreview?: boolean,
  ) => Promise<ExcalidrawImageElement | null | undefined>;
};

/** Resolves with the chosen files, or an empty list when the picker is dismissed. */
function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/**
 * Lets the image tool insert several pictures at once. Excalidraw's own picker takes a single
 * file, so its `onImageAction` is swapped for one with a multi-file picker. One picture keeps
 * the usual behaviour (it follows the cursor until placed); several are inserted in a row,
 * left to right by file name, GAP apart and centred in the view. Excalidraw still loads,
 * compresses and sizes every picture. Returns a function that undoes the patch.
 */
export function enableMultiImageImport(root: HTMLElement, api: ExcalidrawImperativeAPI): () => void {
  const app = findExcalidrawApp(root) as ExcalidrawApp | null;
  if (!app || typeof app.onImageAction !== "function" || typeof app.insertImageElement !== "function") {
    console.warn("Couldn't find the Excalidraw app; the image tool takes one picture at a time.");
    return () => {};
  }
  const original = app.onImageAction;
  const viewCenter = () => {
    const { width, height, offsetLeft, offsetTop } = app.state;
    return viewportCoordsToSceneCoords({ clientX: width / 2 + offsetLeft, clientY: height / 2 + offsetTop }, app.state);
  };

  const insertRow = async (files: File[]) => {
    const center = viewCenter();
    const inserted: ExcalidrawImageElement[] = [];
    for (const file of files) {
      const element = app.createImageElement({ sceneX: center.x, sceneY: center.y, addToFrameUnderCursor: false });
      const result = await app.insertImageElement(element, file);
      if (result && !result.isDeleted) inserted.push(result);
    }
    if (inserted.length === 0) return;

    const rowWidth = inserted.reduce((sum, el) => sum + el.width, 0) + GAP * (inserted.length - 1);
    const top = center.y - Math.max(...inserted.map((el) => el.height)) / 2;
    let x = center.x - rowWidth / 2;
    for (const el of inserted) {
      mutateElement(el, { x, y: top });
      x += el.width + GAP;
    }
    api.updateScene({
      appState: { selectedElementIds: Object.fromEntries(inserted.map((el) => [el.id, true as const])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  app.onImageAction = async ({ insertOnCanvasDirectly }) => {
    const files = (await pickImages()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (files.length === 1 && !insertOnCanvasDirectly) {
      const { x, y } = viewCenter();
      const element = app.createImageElement({ sceneX: x, sceneY: y, addToFrameUnderCursor: false });
      app.setState({ pendingImageElementId: element.id }, () => void app.insertImageElement(element, files[0], true));
      return;
    }
    api.setActiveTool({ type: "selection" });
    try {
      await insertRow(files);
    } catch (err) {
      console.error(err);
    }
  };

  return () => {
    app.onImageAction = original;
  };
}
