// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    // The workflow files live in ../flow/workflows, outside this app's root.
    fs: { allow: [".."] },
  },
  preview: { host: "127.0.0.1" },
});
