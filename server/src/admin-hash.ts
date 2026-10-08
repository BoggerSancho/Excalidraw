import { config } from "./config.ts";
import { getSetting, setSetting } from "./db.ts";
import { isHashShaped, newHash, safeEqual } from "./hash.ts";

let adminHash = "";

/** Loads the admin hash (env var wins), generating and storing one on first start. */
export function initAdminHash(log: (msg: string) => void) {
  const fromEnv = config.adminHashEnv;
  if (fromEnv) {
    if (!isHashShaped(fromEnv)) throw new Error("ADMIN_HASH must be 10-16 characters of 0-9A-Za-z");
    adminHash = fromEnv;
    setSetting("admin_hash", adminHash);
    return;
  }
  const stored = getSetting("admin_hash");
  if (stored) {
    adminHash = stored;
    return;
  }
  adminHash = newHash();
  setSetting("admin_hash", adminHash);
  log(`\n  Admin link generated (shown once): /${adminHash}\n  Retrieve it later with: npm run admin-link\n`);
}

export const getAdminHash = () => adminHash;
export const isAdminHash = (value: string) => adminHash !== "" && safeEqual(value, adminHash);
