// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import {
  DEV_PAGE_PORT,
  LOOPBACK,
  originOf,
  stubPort,
} from './stub-api/address.ts';

const stubOrigin = originOf(stubPort());

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app works from any mount point.
  base: './',
  server: {
    host: LOOPBACK,
    port: DEV_PAGE_PORT,
    strictPort: true,
    // The page and the stub API share one origin in the browser. The stub
    // accepts only its own `Origin`, so the proxy sends that one.
    proxy: {
      '/api': {
        target: stubOrigin,
        changeOrigin: true,
        headers: { Origin: stubOrigin },
      },
    },
  },
  test: {
    // The UI runs in jsdom with the browser setup file. The API contract and
    // the stub run in plain Node, so a new file there needs no pragma.
    projects: [
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test-support/setup.ts'],
          css: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['api/**/*.test.ts', 'stub-api/**/*.test.ts'],
        },
      },
    ],
  },
});
