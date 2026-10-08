import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { ApiError, workspaceApi, type SceneResponse, type SyncMode } from "../api";
import { FileSync } from "./files";
import { PollingSync } from "./pollingSync";
import { PreviewUploader } from "./preview";
import { RealtimeSync } from "./realtimeSync";
import { SceneTracker } from "./tracker";
import type { PointerPayload, SyncController, SyncStatus } from "./types";

const USERNAME_KEY = "excalidraw-workspaces.username";

function readUsername(): string | null {
  try {
    return localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

function saveUsername(name: string) {
  try {
    localStorage.setItem(USERNAME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}

const STATUS_LABEL: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  saving: "Saving…",
  saved: "Saved",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

export default function WorkspacePage({ hash }: { hash: string }) {
  const http = useMemo(() => workspaceApi(hash), [hash]);
  const [loaded, setLoaded] = useState<SceneResponse | null>(null);
  const [gone, setGone] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [mode, setMode] = useState<SyncMode>("realtime");
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [peers, setPeers] = useState(0);
  const [username, setUsername] = useState<string | null>(readUsername);
  const [editingName, setEditingName] = useState(false);
  const controller = useRef<SyncController | null>(null);
  const firstController = useRef(true);

  useEffect(() => {
    http
      .getScene()
      .then((scene) => {
        setLoaded(scene);
        setMode(scene.sync_mode);
        document.title = scene.name;
      })
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setGone(true) : setLoadError(true)));
  }, [http]);

  // Long-lived helpers, created once the editor is ready and shared across transports.
  const helpers = useMemo(() => {
    if (!api || !loaded) return null;
    const tracker = new SceneTracker(api);
    tracker.markSent({ elements: loaded.elements ?? [], appState: loaded.appState ?? {} });
    return { tracker, files: new FileSync(api, http), preview: new PreviewUploader(api, http) };
  }, [api, loaded, http]);

  useEffect(() => {
    if (!helpers) return;
    helpers.files.ensureLoaded();
    return () => {
      helpers.files.dispose();
      helpers.preview.dispose();
    };
  }, [helpers]);

  const usernameRef = useRef(username);
  usernameRef.current = username;

  useEffect(() => {
    if (!api || !helpers || !loaded || gone) return;
    const ctx = {
      hash,
      api,
      http,
      ...helpers,
      onStatus: setStatus,
      onPeers: setPeers,
      onModeChange: setMode,
      onGone: () => setGone(true),
    };
    // On a switch the version we hold is stale, so the poller starts with a full fetch.
    const startVersion = firstController.current ? loaded.version : -1;
    firstController.current = false;
    const instance: SyncController =
      mode === "realtime" ? new RealtimeSync(ctx, usernameRef.current ?? "Guest") : new PollingSync(ctx, startVersion);
    controller.current = instance;
    return () => {
      instance.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, [api, helpers, loaded, mode, gone, hash, http]);

  useEffect(() => {
    if (username) controller.current?.setUsername(username);
  }, [username]);

  useEffect(() => {
    const flush = () => controller.current?.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const onChange = useCallback(() => controller.current?.onLocalChange(), []);
  const onPointerUpdate = useCallback((p: PointerPayload) => controller.current?.onPointer(p), []);

  const initialData = useMemo<ExcalidrawInitialDataState | null>(
    () =>
      loaded && {
        elements: loaded.elements ?? [],
        appState: { viewBackgroundColor: loaded.appState?.viewBackgroundColor ?? "#ffffff" },
        scrollToContent: true,
      },
    [loaded],
  );

  if (gone) {
    return (
      <div className="center-message">
        <div>
          <h2>This workspace is no longer available</h2>
          <p>It may have been deleted. Ask the person who shared the link.</p>
        </div>
      </div>
    );
  }
  if (loadError) return <div className="center-message">Couldn't load this workspace. Check your connection and reload.</div>;
  if (!loaded || !initialData) return <div className="center-message">Loading…</div>;

  const needsName = mode === "realtime" && (!username || editingName);
  const badgeLabel =
    status === "live" ? `Live · ${peers} ${peers === 1 ? "person" : "people"}` : STATUS_LABEL[status];

  return (
    <div className="editor-root">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating={mode === "realtime"}
        name={loaded.name}
        renderTopRightUI={() => (
          <button
            type="button"
            className={`sync-badge sync-${status}`}
            title={
              mode === "realtime"
                ? `Real-time sync. You appear as "${username ?? "Guest"}" (click to change).`
                : "Saved to the server automatically; refreshes every 5 seconds."
            }
            onClick={() => mode === "realtime" && setEditingName(true)}
          >
            <span className="sync-dot" />
            {badgeLabel}
          </button>
        )}
      />
      {needsName && (
        <NameDialog
          initial={username ?? ""}
          onDone={(name) => {
            const value = name.trim() || "Guest";
            saveUsername(value);
            setUsername(value);
            setEditingName(false);
          }}
        />
      )}
    </div>
  );
}

function NameDialog({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(value);
        }}
      >
        <h2>What's your name?</h2>
        <p>Other people in this workspace will see it next to your cursor.</p>
        <input autoFocus maxLength={40} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Guest" />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => onDone(initial || "Guest")}>
            Skip
          </button>
          <button type="submit" className="btn btn-primary">
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
