import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const fontsDir = path.resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/prod/fonts");

// Self-host Excalidraw's fonts instead of loading them from a public CDN.
function excalidrawFonts(): Plugin {
  return {
    name: "excalidraw-fonts",
    configureServer(server) {
      server.middlewares.use("/fonts", (req, res, next) => {
        const file = path.join(fontsDir, decodeURIComponent((req.url ?? "").split("?")[0]));
        if (!file.startsWith(fontsDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader("Content-Type", "font/woff2");
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      fs.cpSync(fontsDir, path.resolve(import.meta.dirname, "dist/fonts"), { recursive: true });
    },
  };
}

const backend = process.env.BACKEND_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), excalidrawFonts()],
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/socket.io": { target: backend, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 4000 },
});
