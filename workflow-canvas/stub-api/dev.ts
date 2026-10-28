// SPDX-License-Identifier: Apache-2.0
/**
 * `npm run dev:stub`. Starts the stub and the Vite dev server together. Ctrl+C
 * stops both. Vite always proxies `/api` to the stub here, even when
 * `WC_API_TARGET` is set in the shell; use `npm run dev` for a real server.
 */
import { fileURLToPath } from 'node:url';
import { TARGET_VARIABLE } from './target.ts';
import { runTogether, type Command, type Together } from './together.ts';

const stubMain = fileURLToPath(new URL('./main.ts', import.meta.url));
const viteBin = fileURLToPath(import.meta.resolve('vite/package.json')).replace(
  /package\.json$/,
  'bin/vite.js',
);

/**
 * The two commands of `dev:stub`. Vite gets an empty `WC_API_TARGET`, so it
 * proxies to the stub even when the shell names another server.
 */
export function devCommands(): Command[] {
  return [
    {
      // The flag only changes the hint that `main.ts` prints.
      file: process.execPath,
      args: [stubMain, '--with-dev-server'],
    },
    {
      file: process.execPath,
      args: [viteBin],
      env: { [TARGET_VARIABLE]: '' },
    },
  ];
}

/** Starts both commands, and stops them on SIGINT or SIGTERM. */
export function startDev(run: typeof runTogether = runTogether): Together {
  const together = run(devCommands());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, together.stop);
  }
  return together;
}

if (import.meta.main) {
  process.exitCode = await startDev().done;
}
