// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import { probePort, probeUntilAnswered, type Probe } from './probe-port.ts';

// Documentation range (RFC 5737): never routed, so packets go nowhere.
const BLACKHOLE = '192.0.2.1';

/** Blocks the event loop, as a paused or starved process does. */
function stallFor(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until);
}

describe('probePort', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  const listen = (host = LOOPBACK): Promise<number> =>
    new Promise((resolve) => {
      server = createServer((socket) => socket.destroy());
      server.listen(0, host, () =>
        resolve((server!.address() as { port: number }).port),
      );
    });

  it('sees a connection that is accepted', async () => {
    expect(await probePort(LOOPBACK, await listen())).toBe('connected');
  });

  it('sees a connection that is refused', async () => {
    const port = await listen();
    server!.close();
    expect(await probePort(LOOPBACK, port)).toBe('refused');
  });

  it('is silent, and prompt, when the address never answers', async () => {
    const started = performance.now();
    expect(await probePort(BLACKHOLE, 9, 200)).toBe('silent');
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // Whether the timeout or the connection is handled first after a stall is
  // not fixed, so several stall lengths are tried; without the one-turn delay
  // about half of them report silence.
  it('still sees a connection when the event loop stalls past the timeout', async () => {
    const port = await listen('0.0.0.0');
    const answers: Probe[] = [];
    for (const stall of [150, 200, 250, 300, 350, 400]) {
      const probe = probePort(LOOPBACK, port, 100);
      stallFor(stall);
      answers.push(await probe);
    }
    expect(answers).toEqual(Array(6).fill('connected'));
  });

  it('probes again while the answer is silence', async () => {
    const started = performance.now();
    expect(await probeUntilAnswered(BLACKHOLE, 9, 3, 100)).toBe('silent');
    expect(performance.now() - started).toBeGreaterThanOrEqual(290);
  });
});
