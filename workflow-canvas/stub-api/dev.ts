// SPDX-License-Identifier: Apache-2.0
/**
 * `npm run dev:stub`. Starts the stub and the Vite dev server together. Ctrl+C
 * stops both. Vite always proxies `/api` to the stub here, even when
 * `WC_API_TARGET` is set in the shell; use `npm run dev` for a real server.
 */
import { fileURLToPath } from 'node:url';
import { TARGET_VARIABLE } from './target.ts';
import { runTogether } from './together.ts';

const stubMain = fileURLToPath(new URL('./main.ts', import.meta.url));
const viteBin = fileURLToPath(import.meta.resolve('vite/package.json')).replace(
  /package\.json$/,
  'bin/vite.js',
);

const { stop, done } = runTogether([
  { file: process.execPath, args: [stubMain] },
  {
    file: process.execPath,
    args: [viteBin],
    env: { [TARGET_VARIABLE]: '' },
  },
]);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, stop);
}
process.exitCode = await done;
