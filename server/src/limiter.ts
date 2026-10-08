import type { IncomingMessage } from "node:http";
import { trustProxy } from "./config.ts";

/** Fixed-window counter keyed by client IP. */
export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  const entryFor = (key: string) => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    return entry;
  };

  return {
    /** Counts a hit and returns false once the limit is exceeded. */
    hit(key: string) {
      const entry = entryFor(key);
      entry.count += 1;
      return entry.count <= limit;
    },
    isBlocked(key: string) {
      return entryFor(key).count >= limit;
    },
  };
}

/** Requests for unknown hashes: 30 per minute per IP before every lookup is refused. */
export const missLimiter = createLimiter(30, 60_000);
/** Overall API/page traffic: generous, just stops floods. */
export const requestLimiter = createLimiter(1200, 60_000);

export function ipOf(req: IncomingMessage): string {
  if (trustProxy) {
    // Use the last entry: it was added by our own proxy. Earlier entries come from the client.
    const forwarded = req.headers["x-forwarded-for"];
    const header = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    const last = header?.split(",").at(-1)?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}
