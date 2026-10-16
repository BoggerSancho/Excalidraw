import { useEffect, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { PanelNumberField } from "./PanelNumberField";
import { fiberAncestors } from "./reactInternals";

const GROUP = "font-size";

/**
 * Font size shown for the selection, like Excalidraw's own panel: text elements and the text
 * inside selected containers count, anything else is ignored. Null when they differ.
 */
function currentSize(elements: readonly ExcalidrawElement[], appState: AppState): number | null {
  const editing = appState.editingTextElement;
  if (editing?.type === "text") return editing.fontSize;
  const byId = new Map(elements.map((el) => [el.id, el]));
  const sizes = new Set<number>();
  for (const el of elements) {
    if (el.isDeleted || !appState.selectedElementIds[el.id]) continue;
    const textId = el.type === "text" ? el.id : el.boundElements?.find((b) => b.type === "text")?.id;
    const text = textId ? byId.get(textId) : undefined;
    if (text?.type === "text" && !text.isDeleted) sizes.add(text.fontSize);
  }
  if (sizes.size === 0) return appState.currentItemFontSize;
  return sizes.size === 1 ? [...sizes][0] : null;
}

/**
 * Excalidraw's own font-size handler. Changing the size also re-measures the text, grows its
 * container and moves arrow labels, and none of that is exported, so the field calls the
 * handler of the hidden button list (found through React's internals) with any value.
 */
function findFontSizeHandler(fieldset: HTMLFieldSetElement): ((size: number) => void) | null {
  const input = fieldset.querySelector(`input[name="${GROUP}"]`);
  if (!input) return null;
  for (const fiber of fiberAncestors(input)) {
    const props = fiber.memoizedProps;
    if (props?.group === GROUP && typeof props.onChange === "function") return props.onChange as (size: number) => void;
  }
  return null;
}

/** Replaces Excalidraw's four font-size buttons (S/M/L/XL) with a number field in pixels. */
export function FontSizeInput({ api, root }: { api: ExcalidrawImperativeAPI; root: HTMLElement }) {
  const [size, setSize] = useState(() => currentSize(api.getSceneElements(), api.getAppState()));

  useEffect(() => api.onChange((elements, appState) => setSize(currentSize(elements, appState))), [api]);

  const apply = (value: number) => {
    const fieldset = root.querySelector(`input[name="${GROUP}"]`)?.closest("fieldset");
    const handler = fieldset && findFontSizeHandler(fieldset);
    if (handler) handler(value);
  };

  return (
    <PanelNumberField
      root={root}
      group={GROUP}
      label="Font size"
      value={size}
      min={1}
      max={1000}
      onCommit={apply}
      canReplace={canReplace}
    />
  );
}

const canReplace = (fieldset: HTMLFieldSetElement) => findFontSizeHandler(fieldset) !== null;
