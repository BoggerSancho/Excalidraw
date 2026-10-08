import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";
import { io, type Socket } from "socket.io-client";
import type { SceneAppState, SyncMode } from "../api";
import type { PointerPayload, SyncContext, SyncController } from "./types";

const SEND_THROTTLE_MS = 80;
const POINTER_THROTTLE_MS = 40;

type RemoteScene = { elements: ExcalidrawElement[]; appState?: SceneAppState; version: number };
type RoomUser = { socketId: string; username: string };

/** Live sync over Socket.IO: element changes and cursors are relayed as they happen. */
export class RealtimeSync implements SyncController {
  private readonly ctx: SyncContext;
  private readonly socket: Socket;
  private username: string;
  private joined = false;
  private sendTimer: number | null = null;
  private lastPointer = 0;
  private collaborators = new Map<SocketId, Collaborator>();

  constructor(ctx: SyncContext, username: string) {
    this.ctx = ctx;
    this.username = username;
    ctx.onStatus("connecting");
    this.socket = io({ path: "/socket.io", reconnectionDelayMax: 5000 });

    this.socket.on("connect", () => this.socket.emit("join", { hash: ctx.hash, username: this.username }));

    this.socket.on("scene:init", (scene: RemoteScene) => {
      this.joined = true;
      ctx.tracker.applyRemote(scene.elements, scene.appState, true);
      ctx.files.ensureLoaded();
      ctx.onStatus("live");
      this.send(); // anything edited while offline
    });

    this.socket.on("scene:update", (scene: RemoteScene) => {
      ctx.tracker.applyRemote(scene.elements, scene.appState, false);
      ctx.files.ensureLoaded();
    });

    this.socket.on("room:users", (users: RoomUser[]) => {
      const next = new Map<SocketId, Collaborator>();
      for (const user of users) {
        if (user.socketId === this.socket.id) continue;
        const id = user.socketId as SocketId;
        next.set(id, { ...this.collaborators.get(id), username: user.username, socketId: id, id: user.socketId });
      }
      this.collaborators = next;
      this.pushCollaborators();
      ctx.onPeers(users.length);
    });

    this.socket.on("pointer", (data: PointerPayload & { socketId: string; username: string }) => {
      const id = data.socketId as SocketId;
      this.collaborators.set(id, {
        ...this.collaborators.get(id),
        socketId: id,
        id: data.socketId,
        username: data.username,
        pointer: data.pointer,
        button: data.button,
      });
      this.pushCollaborators();
    });

    this.socket.on("mode:changed", (data: { sync_mode: SyncMode }) => ctx.onModeChange(data.sync_mode));
    this.socket.on("workspace:gone", () => ctx.onGone());

    this.socket.on("join:error", (data: { reason: string }) => {
      if (data.reason === "polling") ctx.onModeChange("polling");
      else if (data.reason === "not_found") ctx.onGone();
      else ctx.onStatus("offline");
    });

    this.socket.on("disconnect", () => {
      this.joined = false;
      this.collaborators.clear();
      this.pushCollaborators();
      ctx.onStatus("reconnecting");
    });
  }

  private pushCollaborators() {
    this.ctx.api.updateScene({
      collaborators: new Map(this.collaborators),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  onLocalChange() {
    this.ctx.files.uploadNew();
    if (this.sendTimer !== null) return;
    this.sendTimer = window.setTimeout(() => {
      this.sendTimer = null;
      this.send();
    }, SEND_THROTTLE_MS);
  }

  private send() {
    if (!this.joined) return;
    const pending = this.ctx.tracker.pending();
    if (!pending) return;
    this.socket.emit("scene:update", pending);
    this.ctx.tracker.markSent(pending);
    this.ctx.preview.schedule();
  }

  onPointer(payload: PointerPayload) {
    const now = Date.now();
    if (!this.joined || now - this.lastPointer < POINTER_THROTTLE_MS) return;
    this.lastPointer = now;
    this.socket.volatile.emit("pointer", { pointer: payload.pointer, button: payload.button });
  }

  setUsername(name: string) {
    this.username = name;
    if (this.joined) this.socket.emit("username", name);
  }

  flush() {
    if (this.sendTimer !== null) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    this.send();
  }

  dispose() {
    this.flush();
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.collaborators.clear();
    this.pushCollaborators();
  }
}
