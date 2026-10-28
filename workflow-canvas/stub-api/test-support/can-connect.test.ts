// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import { canConnect } from './can-connect.ts';

// Documentation range (RFC 5737): never routed, so packets go nowhere.
const BLACKHOLE = '192.0.2.1';

describe('canConnect', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  const listen = (): Promise<number> =>
    new Promise((resolve) => {
      server = createServer((socket) => socket.destroy());
      server.listen(0, LOOPBACK, () =>
        resolve((server!.address() as { port: number }).port),
      );
    });

  it('is true when something accepts the connection', async () => {
    expect(await canConnect(LOOPBACK, await listen())).toBe(true);
  });

  it('is false when the connection is refused', async () => {
    const port = await listen();
    server!.close();
    expect(await canConnect(LOOPBACK, port)).toBe(false);
  });

  it('is false, and prompt, when the address never answers', async () => {
    const started = performance.now();
    expect(await canConnect(BLACKHOLE, 9, 200)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
