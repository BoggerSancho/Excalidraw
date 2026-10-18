import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Element the Excalidraw editor is rendered in. */
  root: HTMLElement;
  /** `group` of the button list to replace, which is also the name of its radio inputs. */
  group: string;
  label: string;
  /** Current value, or null when the selection is mixed. */
  value: number | null;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  /** Leave the original buttons in place when this returns false. */
  canReplace?: (fieldset: HTMLFieldSetElement) => boolean;
};

/**
 * Replaces one of Excalidraw's button lists in the properties panel with a whole-number
 * field. The library has no API for this, so the field is portalled into the list's
 * fieldset and the original buttons are hidden with CSS.
 */
export function PanelNumberField({ root, group, label, value, min, max, onCommit, canReplace }: Props) {
  const host = useMemo(() => {
    const el = document.createElement("div");
    // While focus is inside `.properties-content`, Excalidraw's text editor doesn't take it back.
    el.className = "panel-number-field properties-content";
    return el;
  }, []);
  const [draft, setDraft] = useState<string | null>(null);
  const textEditor = () => root.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");

  // The panel mounts and unmounts with the selection, so re-attach whenever it reappears.
  useEffect(() => {
    const attach = () => {
      const fieldset = root.querySelector(`input[name="${group}"]`)?.closest("fieldset");
      if (fieldset && host.parentElement !== fieldset && (canReplace?.(fieldset) ?? true)) fieldset.appendChild(host);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [root, group, host, canReplace]);

  return createPortal(
    <input
      type="number"
      min={min}
      max={max}
      step={1}
      inputMode="numeric"
      aria-label={label}
      placeholder={value === null ? "Mixed" : undefined}
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = Number(e.target.value);
        if (e.target.value !== "" && Number.isInteger(next) && next >= min && next <= max) onCommit(next);
      }}
      // Focusing an input would end text editing (and delete text that's still empty). Like
      // Excalidraw does for its own panel buttons, pause the editor's blur handler for the
      // click, so the text stays in editing and the new value applies to it.
      onPointerDown={() => {
        const editor = textEditor();
        if (!editor?.onblur) return;
        const submit = editor.onblur;
        editor.onblur = null;
        window.addEventListener("pointerup", () => setTimeout(() => (editor.onblur = submit)), { once: true });
      }}
      onBlur={() => setDraft(null)}
      // Enter goes back to the text being edited, if any, so typing can continue.
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const editor = textEditor();
        if (editor) editor.focus();
        else e.currentTarget.blur();
      }}
    />,
    host,
  );
}
