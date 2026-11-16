/**
 * Local-only preview of the Qwen + GPT-5.6 Luna analysis. Separate from the production app:
 * its own root and port, no production routes, no Supabase. Run from the repo root:
 *   npx vite --config eval/drawing-dataset/qwen-spatial-audit/review-ui/vite.config.ts
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import baseTailwind from "../../../../tailwind.config";

const ROOT = path.resolve(__dirname, "../../../..");

export default defineConfig({
  root: __dirname,
  publicDir: path.join(ROOT, "eval/drawing-dataset/out/qwen-spatial-audit"),
  plugins: [react()],
  resolve: { alias: { "@": path.join(ROOT, "src") } },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...baseTailwind, content: [path.join(ROOT, "src/**/*.{ts,tsx}"), path.join(__dirname, "**/*.{ts,tsx,html}")] }),
        autoprefixer(),
      ],
    },
  },
  server: { host: "127.0.0.1", port: 5191, strictPort: true, fs: { allow: [ROOT] } },
});
