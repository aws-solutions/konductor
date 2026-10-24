// SPDX-License-Identifier: Apache-2.0
/**
 * Starts the stub API for local development: `npm run stub`. `STUB_PORT` and
 * `STUB_LAUNCH_CODE` override the port and the launch code.
 */
import { DEFAULT_PORT, startStub } from './http/server.ts';

const port = Number(process.env.STUB_PORT ?? DEFAULT_PORT);
const launchCode = process.env.STUB_LAUNCH_CODE || undefined;
const stub = await startStub({ port, launchCode });

console.log('Workflow canvas stub API (local development only, no real auth)');
console.log(`Listening on ${stub.origin}`);
console.log(`Launch address: ${stub.launchAddress}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void stub.close().then(() => process.exit(0)));
}
