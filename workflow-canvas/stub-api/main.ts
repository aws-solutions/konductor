// SPDX-License-Identifier: Apache-2.0
/**
 * `npm run stub`. `STUB_PORT` sets the port. `STUB_WORKFLOW` picks the
 * workflow the session opens: `hello` (the default) runs and passes,
 * `untrusted` refuses a run with `trust_required`, `blocked` ends a run with a
 * blocked stage and `busy` has a run that another program started.
 * `STUB_LAUNCH_CODE` sets the launch code, for tests only: it can be weaker
 * than the contract asks. The flag `--with-dev-server` (set by `dev:stub`)
 * changes the hint it prints, and lets the launch code be traded again, so
 * that reloading the page in the browser is not a dead end: a reload drops
 * both the token and the code.
 */
import { DEV_PAGE_PORT, originOf, stubPort } from './address.ts';
import { exitOnConfigError } from './config-error.ts';
import { stubWorkflow } from './fixture.ts';
import { startStub } from './http/server.ts';

// `npm run dev:stub` passes this flag, since it starts the dev server too. The
// end-to-end tests pass it as well, so a test can open the page again.
const withDevServer = process.argv.includes('--with-dev-server');
const launchCode = process.env.STUB_LAUNCH_CODE || undefined;
const port = exitOnConfigError(() => stubPort());
const root = exitOnConfigError(() => stubWorkflow());
const stub = await startStub({
  port,
  root,
  launchCode,
  reusableLaunchCode: withDevServer,
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
