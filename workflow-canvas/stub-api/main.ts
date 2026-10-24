// SPDX-License-Identifier: Apache-2.0
/**
 * `npm run stub`. `STUB_PORT` sets the port. `STUB_LAUNCH_CODE` sets the launch
 * code, for tests only: it can be weaker than the contract asks.
 */
import { DEV_PAGE_PORT, originOf, stubPort } from './address.ts';
import { startStub } from './http/server.ts';

const launchCode = process.env.STUB_LAUNCH_CODE || undefined;
const stub = await startStub({ port: stubPort(), launchCode });

console.log('Workflow canvas stub API (local development only, no real auth)');
console.log(`Listening on ${stub.origin}`);
console.log('The stub serves no page. With `npm run dev` running, open:');
console.log(`${originOf(DEV_PAGE_PORT)}/#${stub.launchCode}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void stub.close().then(() => process.exit(0)));
}
