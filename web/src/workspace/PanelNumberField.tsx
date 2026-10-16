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
    el.className = "panel-number-field";
    return el;
  }, []);
  const [draft, setDraft] = useState<string | null>(null);

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
      // Focusing an input ends text editing as a plain blur, which drops the selection and
      // closes this panel. Finishing with Escape instead keeps the text selected.
      onPointerDown={() => {
        const editor = root.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");
        editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />,
    host,
  );
}
