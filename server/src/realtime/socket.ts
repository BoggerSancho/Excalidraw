import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "../config.ts";
import { findActiveWorkspace, type SyncMode } from "../db.ts";
import { isHashShaped } from "../hash.ts";
import { ipOf, missLimiter } from "../limiter.ts";
import {
  changeClients,
  getScene,
  isValidElements,
  mergeIntoScene,
  snapshot,
  type SceneAppState,
  type SceneElement,
} from "./scenes.ts";

let io: Server | null = null;

const cleanUsername = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : "Guest";

export function attachSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    maxHttpBufferSize: config.maxSceneBytes,
  });

  io.on("connection", (socket) => {
    const ip = ipOf(socket.request);
    let room: string | null = null;

    socket.on("join", (payload: { hash?: unknown; username?: unknown }) => {
      if (room) return;
      const hash = payload?.hash;
      if (missLimiter.isBlocked(ip)) {
        socket.emit("join:error", { reason: "rate_limited" });
        socket.disconnect(true);
        return;
      }
      const row = typeof hash === "string" && isHashShaped(hash) ? findActiveWorkspace(hash) : undefined;
      if (!row || typeof hash !== "string") {
        missLimiter.hit(ip);
        socket.emit("join:error", { reason: "not_found" });
        socket.disconnect(true);
        return;
      }
      if (row.sync_mode !== "realtime") {
        socket.emit("join:error", { reason: "polling" });
        socket.disconnect(true);
        return;
      }
      const scene = getScene(hash);
      if (!scene) return;
      room = hash;
      socket.data.username = cleanUsername(payload.username);
      socket.join(hash);
      changeClients(hash, 1);
      socket.emit("scene:init", snapshot(scene));
      void broadcastUsers(hash);
    });

    socket.on("scene:update", (payload: { elements?: unknown; appState?: unknown }) => {
      if (!room) return;
      const scene = getScene(room);
      if (!scene || !isValidElements(payload?.elements)) return;
      const before = scene.version;
      const accepted = mergeIntoScene(scene, payload.elements, payload.appState);
      if (scene.version !== before) {
        socket.to(room).emit("scene:update", {
          elements: accepted,
          appState: scene.appState,
          version: scene.version,
        });
      }
    });

    socket.on("pointer", (payload: { pointer?: { x?: unknown; y?: unknown; tool?: unknown }; button?: unknown }) => {
      if (!room) return;
      const p = payload?.pointer;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      socket.volatile.to(room).emit("pointer", {
        socketId: socket.id,
        username: socket.data.username,
        pointer: { x: p.x, y: p.y, tool: p.tool === "laser" ? "laser" : "pointer" },
        button: payload.button === "down" ? "down" : "up",
      });
    });

    socket.on("username", (value: unknown) => {
      if (!room) return;
      socket.data.username = cleanUsername(value);
      void broadcastUsers(room);
    });

    socket.on("disconnect", () => {
      if (!room) return;
      changeClients(room, -1);
      void broadcastUsers(room);
    });
  });
}

async function broadcastUsers(hash: string) {
  if (!io) return;
  const sockets = await io.in(hash).fetchSockets();
  io.to(hash).emit(
    "room:users",
    sockets.map((s) => ({ socketId: s.id, username: s.data.username as string })),
  );
}

/** Relays changes saved over HTTP (polling clients) to real-time clients. */
export function broadcastSceneUpdate(hash: string, elements: SceneElement[], appState: SceneAppState, version: number) {
  io?.to(hash).emit("scene:update", { elements, appState, version });
}

/** Clients switch transport themselves when they receive this. */
export function notifyModeChanged(hash: string, syncMode: SyncMode) {
  io?.to(hash).emit("mode:changed", { sync_mode: syncMode });
}

export function notifyGone(hash: string) {
  if (!io) return;
  io.to(hash).emit("workspace:gone");
  const server = io;
  setTimeout(() => server.in(hash).disconnectSockets(true), 1000);
}
