import { defineConfig, mergeConfig } from "vite";
import type { Plugin } from "vite";
import baseViteConfig from "./vite.config";

const PARALLEL_SCRAPER_ORIGIN = "http://127.0.0.1:3002";
const PARALLEL_FRONTEND_PORT = 5001;

/**
 * Parallel frontend dev: same app as default Vite, but:
 * - dev server on port 5001 (default stays 5000)
 * - /api and /view-file proxy → parallel scraper (:3002)
 *
 * Does not change vite.config.ts or npm run dev.
 */

function parallelDevIndicatorPlugin(): Plugin {
  return {
    name: "parallel-frontend-dev-indicator",
    configureServer() {
      console.log(
        `\n[parallel-frontend] Dev server: http://localhost:${PARALLEL_FRONTEND_PORT}`,
      );
      console.log(
        `[parallel-frontend] Proxy /api + /view-file → ${PARALLEL_SCRAPER_ORIGIN}\n`,
      );
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const snippet = `<script>console.info("%c[parallel frontend test]%c API proxy → ${PARALLEL_SCRAPER_ORIGIN}","color:#d97706;font-weight:bold","");</script>`;
        return html.replace("<head>", `<head>${snippet}`);
      },
    },
  };
}

export default defineConfig((configEnv) => {
  const base =
    typeof baseViteConfig === "function"
      ? baseViteConfig(configEnv)
      : baseViteConfig;

  return mergeConfig(base, {
    /** Force scraper API calls to same origin so /api is proxied to parallel-dev-server (:3002), not direct :3001 from .env */
    define: {
      "import.meta.env.VITE_SCRAPER_USE_SAME_ORIGIN": JSON.stringify("true"),
    },
    server: {
      host: "::",
      port: PARALLEL_FRONTEND_PORT,
      strictPort: true,
      allowedHosts: true,
      watch: {
        ignored: [
          "**/node_modules/**",
          "**/.cache/**",
          "**/scraper-service/downloads/**",
        ],
      },
      proxy: {
        "/api": {
          target: PARALLEL_SCRAPER_ORIGIN,
          changeOrigin: true,
          secure: false,
        },
        "/view-file": {
          target: PARALLEL_SCRAPER_ORIGIN,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [parallelDevIndicatorPlugin()],
  });
});
