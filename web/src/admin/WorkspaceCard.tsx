import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Workspace } from "../api";
import { daysUntil, formatDateTime, formatRelative } from "./format";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

type Props = {
  workspace: Workspace;
  trashed?: boolean;
  menu: MenuItem[];
  renaming?: boolean;
  onOpen?: () => void;
  onRename?: (name: string) => void;
  onRenameCancel?: () => void;
};

export function WorkspaceCard({ workspace: ws, trashed, menu, renaming, onOpen, onRename, onRenameCancel }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  let meta: ReactNode;
  if (trashed && ws.deleted_at && ws.purge_at) {
    const days = daysUntil(ws.purge_at);
    meta = (
      <>
        <span title={formatRelative(ws.deleted_at)}>Deleted {formatDateTime(ws.deleted_at)}</span>
        <span className="card-warn">
          Deleted permanently {days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}
        </span>
      </>
    );
  } else {
    meta = <span title={formatRelative(ws.updated_at)}>{formatDateTime(ws.updated_at)}</span>;
  }

  return (
    <article className={`card${trashed ? " card-trashed" : ""}`}>
      <button
        type="button"
        className="card-preview"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={onOpen ? `Open ${ws.name}` : ws.name}
      >
        {ws.preview_url ? (
          <img src={ws.preview_url} alt="" loading="lazy" />
        ) : (
          <span className="card-placeholder">Empty canvas</span>
        )}
        {ws.sync_mode === "polling" && !trashed && <span className="badge">Polling</span>}
      </button>

      <div className="card-body">
        {renaming ? (
          <RenameInput initial={ws.name} onSubmit={(v) => onRename?.(v)} onCancel={() => onRenameCancel?.()} />
        ) : (
          <h3 className="card-name" title={ws.name}>
            {ws.name}
          </h3>
        )}
        <div className="card-meta">{meta}</div>
        {trashed && (
          <div className="card-actions">
            {menu.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`btn btn-small${item.danger ? " btn-danger" : ""}`}
                onClick={item.onSelect}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!trashed && (
        <div className="card-menu" ref={menuRef}>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Actions for ${ws.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {menu.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.danger ? "danger" : ""}
                  onClick={() => {
                    setMenuOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function RenameInput({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const submit = () => {
    if (done.current) return;
    done.current = true;
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSubmit(trimmed);
    else onCancel();
  };
  return (
    <input
      className="rename-input"
      autoFocus
      maxLength={100}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
    />
  );
}
