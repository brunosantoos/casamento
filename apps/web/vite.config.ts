import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Proxy para a API: front e back na mesma origem, cookies de sessão do better-auth funcionam sem CORS
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    port: 5190,
    strictPort: true,
    proxy: {
      "/trpc": "http://localhost:4100",
      "/api": "http://localhost:4100",
      "/webhooks": "http://localhost:4100",
    },
  },
});
