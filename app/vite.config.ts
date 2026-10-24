import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/_build": "http://localhost:8787",
      "/homepage_imgs": "http://localhost:8787",
      "/pieces": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    // One bundle on purpose: pages load instantly when you navigate.
    chunkSizeWarningLimit: 900,
  },
});
