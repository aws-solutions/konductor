// SPDX-License-Identifier: Apache-2.0
/** Checks where `npm run dev` sends `/api`, and which `Origin` it sends. */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer, resolveConfig, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOPBACK, originOf } from '../address.ts';
import { LAUNCH_CODE, openStub } from '../test-support/harness.ts';

const CONFIG = new URL('../../vite.config.ts', import.meta.url).pathname;
const VARIABLES = ['STUB_PORT', 'WC_API_TARGET'] as const;

/** A server that records each request it gets and answers 204. */
async function openRecorder() {
  const seen: IncomingMessage[] = [];
  const server: Server = createHttpServer((req, res) => {
    seen.push(req);
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const port = (server.address() as AddressInfo).port;
  const close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return { seen, origin: originOf(port), close };
}

describe('the Vite dev server', () => {
  let dev: ViteDevServer | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  const saved = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));

  /** Sets or clears the variables that choose the API target. */
  function useEnv(env: Partial<Record<(typeof VARIABLES)[number], string>>) {
    for (const name of VARIABLES) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
  }

  /** Starts Vite with the config of the project and returns its origin. */
  async function startDev(): Promise<string> {
    dev = await createServer({
      configFile: CONFIG,
      logLevel: 'silent',
      server: { host: LOOPBACK, port: 0, strictPort: false },
    });
    await dev.listen();
    return `http://${LOOPBACK}:${dev.config.server.port}`;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await dev?.close();
    dev = undefined;
    for (const close of cleanups.splice(0)) await close();
    for (const name of VARIABLES) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('forwards /api to the stub by default, which accepts the dev origin', async () => {
    const running = await openStub();
    cleanups.push(running.stub.close);
    useEnv({ STUB_PORT: String(running.stub.port) });
    const devOrigin = await startDev();
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

  it('forwards /api to WC_API_TARGET and sends that origin, not the stub', async () => {
    const stub = await openStub();
    const target = await openRecorder();
    cleanups.push(stub.stub.close, target.close);
    useEnv({
      STUB_PORT: String(stub.stub.port),
      WC_API_TARGET: target.origin,
    });
    const devOrigin = await startDev();

    const reply = await fetch(`${devOrigin}/api/workflow?probe=1`);

    expect(reply.status).toBe(204);
    expect(target.seen).toHaveLength(1);
    expect(target.seen[0]?.url).toBe('/api/workflow?probe=1');
    expect(target.seen[0]?.headers.origin).toBe(target.origin);
    expect(target.origin).not.toBe(stub.stub.origin);
  });

  it('moves with the target: a second target gets its own origin', async () => {
    const first = await openRecorder();
    const second = await openRecorder();
    cleanups.push(first.close, second.close);

    useEnv({ WC_API_TARGET: first.origin });
    const firstDev = await startDev();
    await fetch(`${firstDev}/api/workflow`);
    await dev?.close();

    useEnv({ WC_API_TARGET: second.origin });
    const secondDev = await startDev();
    await fetch(`${secondDev}/api/workflow`);

    expect(first.seen.map((r) => r.headers.origin)).toEqual([first.origin]);
    expect(second.seen.map((r) => r.headers.origin)).toEqual([second.origin]);
  });

  it('refuses to start for a bad WC_API_TARGET, with one clear line', async () => {
    useEnv({ WC_API_TARGET: 'not-a-target' });
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit called');
    }) as never);
    const print = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(startDev()).rejects.toThrow('exit called');

    expect(print).toHaveBeenCalledWith(
      expect.stringContaining('WC_API_TARGET="not-a-target" is not usable'),
    );
  });

  it.each([
    ['build', 'build', 'production'],
    ['the test runner', 'serve', 'test'],
  ] as const)(
    'ignores a bad WC_API_TARGET for %s, which has no proxy',
    async (_name, command, mode) => {
      useEnv({ WC_API_TARGET: 'not-a-target' });
      const exit = vi.spyOn(process, 'exit');

      const config = await resolveConfig(
        { configFile: CONFIG, logLevel: 'silent' },
        command,
        mode,
      );

      expect(exit).not.toHaveBeenCalled();
      expect(config.server.proxy).toBeUndefined();
    },
  );
});
