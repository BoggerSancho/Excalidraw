import { useEffect, useState } from "react";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { PanelNumberField } from "./PanelNumberField";

// The field shows tenths of Excalidraw's stroke width, so 10 is its "thin" (1) and 20 its "bold" (2).
const SCALE = 10;

/** Common field value of the selection, null when it's mixed, or the default for new shapes. */
function currentWidth(elements: readonly ExcalidrawElement[], appState: AppState): number | null {
  const widths = new Set(
    elements
      .filter((el) => !el.isDeleted && appState.selectedElementIds[el.id])
      .map((el) => Math.round(el.strokeWidth * SCALE)),
  );
  if (widths.size === 0) return Math.round(appState.currentItemStrokeWidth * SCALE);
  return widths.size === 1 ? [...widths][0] : null;
}

/** Replaces Excalidraw's three stroke-width buttons with a number field. */
export function StrokeWidthInput({ api, root }: { api: ExcalidrawImperativeAPI; root: HTMLElement }) {
  const [width, setWidth] = useState(() => currentWidth(api.getSceneElements(), api.getAppState()));

  useEffect(() => api.onChange((elements, appState) => setWidth(currentWidth(elements, appState))), [api]);

  const apply = (value: number) => {
    const strokeWidth = value / SCALE;
    const { selectedElementIds } = api.getAppState();
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((el) => (selectedElementIds[el.id] && !el.isDeleted ? newElementWith(el, { strokeWidth }) : el)),
      appState: { currentItemStrokeWidth: strokeWidth },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  return (
    <PanelNumberField
      root={root}
      group="stroke-width"
      label="Stroke width"
      value={width}
      min={1}
      max={1000}
      onCommit={apply}
    />
  );
}
