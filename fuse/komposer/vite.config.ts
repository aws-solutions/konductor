// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    // The app imports the engine's browser-safe modules from ../flow/src.
    fs: { allow: [".."] },
    // `bun run start` serves the API; changeOrigin sends the Host header the
    // server accepts.
    proxy: { "/api": { target: "http://127.0.0.1:4807", changeOrigin: true } },
  },
  preview: { host: "127.0.0.1" },
});
