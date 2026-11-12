/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // During `npm run dev` the API runs via `vercel dev` on :3000; proxy it.
    proxy: { "/api": "http://localhost:3000" },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
