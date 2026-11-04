// SPDX-License-Identifier: Apache-2.0
/**
 * `npm run stub`. `STUB_PORT` sets the port. `STUB_LAUNCH_CODE` sets the launch
 * code, for tests only: it can be weaker than the contract asks. The flag
 * `--with-dev-server` (set by `dev:stub`) changes the hint it prints, and lets
 * the launch code be traded again, so that opening the printed address twice
 * is not a dead end. `STUB_STRICT=1` turns that off: the code works once.
 */
import { DEV_PAGE_PORT, originOf, stubPort } from './address.ts';
import { exitOnConfigError } from './config-error.ts';
import { reusableLaunchCode } from './launch-mode.ts';
import { startStub } from './http/server.ts';

// `npm run dev:stub` passes this flag, since it starts the dev server too.
const withDevServer = process.argv.includes('--with-dev-server');
const launchCode = process.env.STUB_LAUNCH_CODE || undefined;
const port = exitOnConfigError(() => stubPort());
const stub = await startStub({
  port,
  launchCode,
  reusableLaunchCode: reusableLaunchCode(process.argv, process.env),
});

console.log('Workflow canvas stub API (local development only, no real auth)');
console.log(`Listening on ${stub.origin}`);
console.log(
  withDevServer
    ? 'The stub serves no page. The dev server runs beside it; open:'
    : 'The stub serves no page. With `npm run dev` running, open:',
);
console.log(`${originOf(DEV_PAGE_PORT)}/#${stub.launchCode}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void stub.close().then(() => process.exit(0)));
}
