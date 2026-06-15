import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // ES-module workers so the Kokoro TTS worker can use `import.meta` (kokoro-js relies on it
  // to resolve its wasm/model assets). The default 'iife' worker format breaks that.
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    chunkSizeWarningLimit: 3200,
  },
});
