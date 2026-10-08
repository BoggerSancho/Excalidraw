import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type Workspace } from "../api";
import { ConfirmModal } from "./ConfirmModal";
import { SortControl, type SortState } from "./SortControl";
import { WorkspaceCard } from "./WorkspaceCard";

const SORT_KEY = "excalidraw-workspaces.sort";
const REFRESH_MS = 15_000;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function loadSort(): SortState {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_KEY) ?? "") as SortState;
    if ((parsed.key === "name" || parsed.key === "updated") && (parsed.dir === "asc" || parsed.dir === "desc")) return parsed;
  } catch {
    /* missing or unavailable */
  }
  return { key: "updated", dir: "desc" };
}

function sortWorkspaces(list: Workspace[], sort: SortState) {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) =>
    dir * (sort.key === "name" ? collator.compare(a.name, b.name) : a.updated_at.localeCompare(b.updated_at)),
  );
}

type Confirm = {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => Promise<void>;
};

const linkFor = (hash: string) => `${location.origin}/${hash}`;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary textarea.
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export default function AdminPage({ adminHash }: { adminHash: string }) {
  const api = useMemo(() => adminApi(adminHash), [adminHash]);
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [trash, setTrash] = useState<Workspace[]>([]);
  const [sort, setSort] = useState<SortState>(loadSort);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [active, trashed] = await Promise.all([api.list(), api.trash()]);
      setWorkspaces(active);
      setTrash(trashed);
    } catch {
      showToast("Couldn't refresh workspaces");
    }
  }, [api, showToast]);

  useEffect(() => {
    document.title = "Workspaces · Admin";
    void refresh();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const changeSort = (next: SortState) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const sorted = useMemo(() => (workspaces ? sortWorkspaces(workspaces, sort) : []), [workspaces, sort]);

  const replace = (ws: Workspace) => setWorkspaces((list) => list?.map((w) => (w.hash === ws.hash ? ws : w)) ?? null);

  const create = async () => {
    setCreating(true);
    try {
      const ws = await api.create();
      setWorkspaces((list) => [ws, ...(list ?? [])]);
      showToast(`Created ${ws.name}`);
    } catch {
      showToast("Couldn't create a workspace");
    } finally {
      setCreating(false);
    }
  };

  const rename = async (ws: Workspace, name: string) => {
    setRenaming(null);
    replace({ ...ws, name });
    try {
      replace(await api.update(ws.hash, { name }));
    } catch {
      replace(ws);
      showToast("Couldn't rename the workspace");
    }
  };

  const toggleMode = async (ws: Workspace) => {
    const sync_mode = ws.sync_mode === "realtime" ? "polling" : "realtime";
    try {
      replace(await api.update(ws.hash, { sync_mode }));
      showToast(`${ws.name}: ${sync_mode === "realtime" ? "real-time sync" : "polling sync"}`);
    } catch {
      showToast("Couldn't change the sync mode");
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch {
      showToast("Something went wrong; try again");
    } finally {
      setBusy(false);
    }
  };

  const askTrash = (ws: Workspace) =>
    setConfirm({
      title: "Move to trash?",
      message: `Move "${ws.name}" to trash? Its link stops working right away, and it will be deleted permanently after 30 days.`,
      confirmLabel: "Move to trash",
      action: async () => {
        await api.remove(ws.hash);
        await refresh();
        showToast(`Moved ${ws.name} to trash`);
      },
    });

  const askPurge = (ws: Workspace) =>
    setConfirm({
      title: "Delete permanently?",
      message: `Permanently delete "${ws.name}"? This cannot be undone.`,
      confirmLabel: "Delete permanently",
      action: async () => {
        await api.purge(ws.hash);
        setTrash((list) => list.filter((w) => w.hash !== ws.hash));
        showToast(`Deleted ${ws.name}`);
      },
    });

  const restore = async (ws: Workspace) => {
    try {
      await api.restore(ws.hash);
      await refresh();
      showToast(`Restored ${ws.name}`);
    } catch {
      showToast("Couldn't restore the workspace");
    }
  };

  const open = (ws: Workspace) => window.open(`/${ws.hash}`, "_blank", "noopener,noreferrer");

  return (
    <div className="admin">
      <header className="admin-header">
        <h1>Workspaces</h1>
        <nav className="tabs" aria-label="View">
          <button type="button" className={tab === "active" ? "active" : ""} onClick={() => setTab("active")}>
            Workspaces <span className="count">{workspaces?.length ?? "–"}</span>
          </button>
          <button type="button" className={tab === "trash" ? "active" : ""} onClick={() => setTab("trash")}>
            Trash <span className="count">{trash.length}</span>
          </button>
        </nav>
        <div className="admin-actions">
          {tab === "active" && <SortControl value={sort} onChange={changeSort} />}
          {tab === "active" && (
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              + New workspace
            </button>
          )}
        </div>
      </header>

      <main>
        {tab === "active" && workspaces === null && <p className="empty">Loading…</p>}
        {tab === "active" && workspaces?.length === 0 && (
          <div className="empty">
            <p>No workspaces yet.</p>
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              + Create your first workspace
            </button>
          </div>
        )}
        {tab === "trash" && trash.length === 0 && (
          <p className="empty">Trash is empty. Deleted workspaces stay here for 30 days.</p>
        )}

        <div className="grid">
          {tab === "active" &&
            sorted.map((ws) => (
              <WorkspaceCard
                key={ws.hash}
                workspace={ws}
                renaming={renaming === ws.hash}
                onOpen={() => open(ws)}
                onRename={(name) => void rename(ws, name)}
                onRenameCancel={() => setRenaming(null)}
                menu={[
                  { label: "Open", onSelect: () => open(ws) },
                  { label: "Rename", onSelect: () => setRenaming(ws.hash) },
                  {
                    label: "Copy link",
                    onSelect: () => void copyText(linkFor(ws.hash)).then(() => showToast("Link copied")),
                  },
                  {
                    label: ws.sync_mode === "realtime" ? "Switch to polling sync" : "Switch to real-time sync",
                    onSelect: () => void toggleMode(ws),
                  },
                  { label: "Delete…", danger: true, onSelect: () => askTrash(ws) },
                ]}
              />
            ))}
          {tab === "trash" &&
            trash.map((ws) => (
              <WorkspaceCard
                key={ws.hash}
                workspace={ws}
                trashed
                menu={[
                  { label: "Restore", onSelect: () => void restore(ws) },
                  { label: "Delete permanently…", danger: true, onSelect: () => askPurge(ws) },
                ]}
              />
            ))}
        </div>
      </main>

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger
          busy={busy}
          onConfirm={() => void runConfirm()}
          onCancel={() => !busy && setConfirm(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
