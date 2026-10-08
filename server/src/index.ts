import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { initAdminHash, isAdminHash } from "./admin-hash.ts";
import { config } from "./config.ts";
import { db, findActiveWorkspace, getSetting, setSetting } from "./db.ts";
import { isHashShaped } from "./hash.ts";
import { ipOf, missLimiter, requestLimiter } from "./limiter.ts";
import { flushAll } from "./realtime/scenes.ts";
import { attachSocket } from "./realtime/socket.ts";
import { adminRoutes } from "./routes/admin.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import { purgeExpired } from "./trash.ts";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: config.maxSceneBytes,
  // Hashes are secrets: keep them out of request logs.
  disableRequestLogging: true,
});

initAdminHash((msg) => console.log(msg));
if (!getSetting("next_workspace_number")) setSetting("next_workspace_number", "1");

app.addContentTypeParser(/^image\//, { parseAs: "buffer", bodyLimit: config.maxFileBytes }, (_req, body, done) =>
  done(null, body),
);

app.addHook("onRequest", async (req, reply) => {
  const url = req.url;
  if (url.startsWith("/assets/") || url.startsWith("/fonts/")) return;
  if (!requestLimiter.hit(ipOf(req.raw))) return reply.code(429).send({ error: "rate_limited" });
});

app.addHook("onSend", async (_req, reply) => {
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Robots-Tag", "noindex, nofollow");
  reply.header("X-Content-Type-Options", "nosniff");
});

// --- API ---------------------------------------------------------------------------------
app.register(adminRoutes, { prefix: "/api/admin/:adminHash" });
app.register(workspaceRoutes, { prefix: "/api/w/:wsHash" });

type Page = "admin" | "workspace";

function resolvePage(hash: string): Page | null {
  if (isAdminHash(hash)) return "admin";
  if (isHashShaped(hash) && findActiveWorkspace(hash)) return "workspace";
  return null;
}

app.get("/api/resolve/:hash", async (req, reply) => {
  const ip = ipOf(req.raw);
  if (missLimiter.isBlocked(ip)) return reply.code(429).send({ error: "rate_limited" });
  const page = resolvePage((req.params as { hash: string }).hash);
  if (!page) {
    missLimiter.hit(ip);
    return reply.code(404).send({ error: "not_found" });
  }
  return { page };
});

app.get("/api/health", async () => ({ ok: true }));

// --- Pages -------------------------------------------------------------------------------
const indexFile = path.join(config.webDist, "index.html");
const hasWeb = fs.existsSync(indexFile);
const notFoundHtml =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<title>Not found</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;' +
  "height:100vh;margin:0;color:#555}</style><p>Nothing here.</p>";

if (hasWeb) {
  app.register(fastifyStatic, { root: path.join(config.webDist, "assets"), prefix: "/assets/", maxAge: "365d", immutable: true });
  app.register(fastifyStatic, { root: path.join(config.webDist, "fonts"), prefix: "/fonts/", decorateReply: false, maxAge: "30d" });
} else {
  app.log.warn(`No web build at ${config.webDist}; run "npm run build" (pages will 404).`);
}

app.get("/robots.txt", async (_req, reply) => reply.type("text/plain").send("User-agent: *\nDisallow: /\n"));

app.get("/:hash", async (req, reply) => {
  const ip = ipOf(req.raw);
  if (missLimiter.isBlocked(ip)) return reply.code(429).type("text/html").send(notFoundHtml);
  const page = resolvePage((req.params as { hash: string }).hash);
  if (!page || !hasWeb) {
    if (!page) missLimiter.hit(ip);
    return reply.code(404).type("text/html").send(notFoundHtml);
  }
  const html = fs
    .readFileSync(indexFile, "utf8")
    .replace("<head>", `<head><script>window.__PAGE__=${JSON.stringify(page)}</script>`);
  reply.header("Cache-Control", "no-store");
  return reply.type("text/html").send(html);
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
  return reply.code(404).type("text/html").send(notFoundHtml);
});

// --- Lifecycle ---------------------------------------------------------------------------
const purged = purgeExpired();
if (purged) app.log.info(`Purged ${purged} expired workspace(s) from trash`);
setInterval(() => {
  const n = purgeExpired();
  if (n) app.log.info(`Purged ${n} expired workspace(s) from trash`);
}, 60 * 60 * 1000).unref();

attachSocket(app.server);

async function shutdown(signal: string) {
  app.log.info(`${signal} received, saving open workspaces`);
  flushAll();
  await app.close();
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.port, host: config.host });
