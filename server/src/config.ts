import path from "node:path";

const hashLength = Number(process.env.HASH_LENGTH ?? 12);
if (!Number.isInteger(hashLength) || hashLength < 10 || hashLength > 16) {
  throw new Error("HASH_LENGTH must be an integer between 10 and 16");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  webDist: path.resolve(process.env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname),
  adminHashEnv: process.env.ADMIN_HASH || undefined,
  hashLength,
  trashRetentionDays: Number(process.env.TRASH_RETENTION_DAYS ?? 30),
  persistIntervalMs: 2000,
  maxSceneBytes: 20 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxPreviewBytes: 2 * 1024 * 1024,
};

// Set TRUST_PROXY=true only when the app is reachable exclusively through a reverse proxy
// that sets X-Forwarded-For; otherwise clients could spoof their IP to dodge rate limits.
export const trustProxy = process.env.TRUST_PROXY === "true";
