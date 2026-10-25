// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { DEV_PAGE_PORT, LOOPBACK } from './stub-api/address.ts';
import { apiTargetOrExit } from './stub-api/target.ts';

/**
 * Where `/api` goes, or `undefined` for a command that serves no page. A bad
 * `WC_API_TARGET` then stops only `dev` and `preview`: `build` and Vitest
 * (mode `test`) never use the proxy, so they never read the variable. The unit
 * tests of the Playwright config set the variable themselves, so a bad value in
 * the shell does not reach them either.
 */
function proxyTarget(command: string, mode: string): string | undefined {
  return command === 'serve' && mode !== 'test'
    ? apiTargetOrExit().origin
    : undefined;
}

// The page always calls the relative `/api`. Only the target changes: the stub
// by default, or the server named by `WC_API_TARGET`.
export default defineConfig(({ command, mode }) => {
  const apiOrigin = proxyTarget(command, mode);
  return {
    plugins: [react()],
    // Relative asset paths so the built app works from any mount point.
    base: './',
    server: {
      host: LOOPBACK,
      port: DEV_PAGE_PORT,
      strictPort: true,
      // The page and the API share one origin in the browser. The server
      // accepts only its own `Origin`, so the proxy sends the target's.
      proxy: apiOrigin
        ? {
            '/api': {
              target: apiOrigin,
              changeOrigin: true,
              headers: { Origin: apiOrigin },
            },
          }
        : undefined,
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
            include: [
              'api/**/*.test.ts',
              'stub-api/**/*.test.ts',
              'test-support/**/*.test.ts',
            ],
          },
        },
      ],
    },
  };
});
