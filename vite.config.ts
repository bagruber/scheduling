import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Im Dev laeuft die API getrennt (pnpm dev:api) und wird hierher geproxied.
// In Produktion serviert derselbe Node-Prozess dist/ und /api.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8080" },
  },
});
