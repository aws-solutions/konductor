// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import {
  probePort,
  probeUntilAnswered,
  type Connect,
  type Probe,
} from './probe-port.ts';

/**
 * A stand-in for `net.connect` that opens no connection. Each socket it makes
 * says nothing but the timeout the probe sets, as a dropped packet would;
 * the first `answerAfter` sockets stay silent and later ones connect.
 */
function fakeConnect(answerAfter = Infinity) {
  const sockets: Array<EventEmitter & { destroyed: boolean }> = [];
  const open: Connect = () => {
    const event = sockets.length >= answerAfter ? 'connect' : 'timeout';
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() {
        this.destroyed = true;
        return this;
      },
      setTimeout(timeout: number) {
        setTimeout(() => socket.emit(event), timeout);
        return this;
      },
    });
    sockets.push(socket);
    return socket as unknown as ReturnType<Connect>;
  };
  return { open, sockets };
}

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

  it('is silent when nothing answers before the timeout, and gives the socket up', async () => {
    const { open, sockets } = fakeConnect();

    expect(await probePort('192.0.2.1', 9, 20, open)).toBe('silent');
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.destroyed).toBe(true);
  });

  // Each stall hits a different point: before the connect tick, after one
  // tick, and after one immediate. A stall must never read as silence.
  const stallPoints: Array<[string, (stall: () => void) => void]> = [
    ['before the connect tick', (stall) => stall()],
    ['after one tick', (stall) => process.nextTick(stall)],
    ['after one immediate', (stall) => setImmediate(stall)],
  ];

  it.each(stallPoints)(
    'still sees a connection when the event loop stalls %s past the timeout',
    async (_, schedule) => {
      const port = await listen('0.0.0.0');
      const answers: Probe[] = [];
      for (const stall of [150, 200, 250, 300, 350, 400]) {
        const probe = probePort(LOOPBACK, port, 100);
        schedule(() => stallFor(stall));
        answers.push(await probe);
      }
      expect(answers).toEqual(Array(6).fill('connected'));
    },
  );

  it('is silent for an address that drops packets, after the timeout', async () => {
    const started = performance.now();
    const { open } = fakeConnect();

    expect(await probePort('192.0.2.1', 9, 50, open)).toBe('silent');
    expect(performance.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('arms the timeout only after the connect tick', async () => {
    const calls: string[] = [];
    const open: Connect = () => {
      const socket = Object.assign(new EventEmitter(), {
        destroy: () => socket,
        setTimeout: () => {
          calls.push('timeout armed');
          return socket;
        },
      });
      calls.push('connect sent');
      setImmediate(() => socket.emit('connect'));
      return socket as unknown as ReturnType<Connect>;
    };

    const probe = probePort('192.0.2.1', 9, 20, open);
    expect(calls).toEqual(['connect sent']);
    expect(await probe).toBe('connected');
    expect(calls).toEqual(['connect sent', 'timeout armed']);
  });

  it('probes again while the answer is silence, up to the attempts given', async () => {
    const { open, sockets } = fakeConnect();

    expect(await probeUntilAnswered('192.0.2.1', 9, 3, 20, open)).toBe(
      'silent',
    );
    expect(sockets).toHaveLength(3);
  });

  it('stops probing once an attempt gets an answer', async () => {
    const { open, sockets } = fakeConnect(1);

    expect(await probeUntilAnswered('192.0.2.1', 9, 3, 20, open)).toBe(
      'connected',
    );
    expect(sockets).toHaveLength(2);
  });
});
