// Prints the stored admin link: `npm run admin-link` (or `podman exec <ctr> npm run admin-link`).
import { getSetting } from "./db.ts";

const hash = process.env.ADMIN_HASH || getSetting("admin_hash");
console.log(hash ? `/${hash}` : "No admin hash yet; start the server once to generate it.");
