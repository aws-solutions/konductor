// SPDX-License-Identifier: Apache-2.0
/** Checks that `npm run dev` reaches the stub through its proxy, on one origin. */
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import { LAUNCH_CODE, openStub } from '../test-support/harness.ts';

const CONFIG = new URL('../../vite.config.ts', import.meta.url).pathname;

describe('the Vite dev server', () => {
  let dev: ViteDevServer | undefined;
  let stopStub: (() => Promise<void>) | undefined;
  const savedPort = process.env.STUB_PORT;

  afterEach(async () => {
    await dev?.close();
    await stopStub?.();
    if (savedPort === undefined) delete process.env.STUB_PORT;
    else process.env.STUB_PORT = savedPort;
  });

  it('forwards /api to the stub, which accepts the call on the dev origin', async () => {
    const running = await openStub();
    stopStub = running.stub.close;
    process.env.STUB_PORT = String(running.stub.port);
    dev = await createServer({
      configFile: CONFIG,
      logLevel: 'silent',
      server: { host: LOOPBACK, port: 0, strictPort: false },
    });
    await dev.listen();
    const devOrigin = `http://${LOOPBACK}:${dev.config.server.port}`;
    const headers = { 'Content-Type': 'application/json', Origin: devOrigin };

    const session = await fetch(`${devOrigin}/api/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: LAUNCH_CODE }),
    });
    expect(session.status).toBe(200);
    const { token } = (await session.json()) as { token: string };

    const workflow = await fetch(`${devOrigin}/api/workflow`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(workflow.status).toBe(200);
    expect(await workflow.json()).toMatchObject({ name: 'hello' });
  });
});
