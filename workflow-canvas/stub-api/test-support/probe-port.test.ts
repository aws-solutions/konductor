// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import {
  probeFromError,
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

/** A stand-in whose connect fails at once with the given socket error code. */
function failingConnect(code: string) {
  const open: Connect = () => {
    const socket = Object.assign(new EventEmitter(), {
      destroy: () => socket,
      setTimeout: () => socket,
    });
    setImmediate(() =>
      socket.emit('error', Object.assign(new Error(code), { code })),
    );
    return socket as unknown as ReturnType<Connect>;
  };
  return open;
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
    expect(await probePort(LOOPBACK, await listen())).toEqual({
      kind: 'connected',
    });
  });

  it('sees a connection that is refused', async () => {
    const port = await listen();
    server!.close();
    expect(await probePort(LOOPBACK, port)).toEqual({ kind: 'refused' });
  });

  it('is silent when nothing answers before the timeout, and gives the socket up', async () => {
    const { open, sockets } = fakeConnect();

    expect(await probePort('192.0.2.1', 9, 20, open)).toEqual({
      kind: 'silent',
    });
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
      expect(answers).toEqual(Array(6).fill({ kind: 'connected' }));
    },
  );

  it('is silent for an address that drops packets, after the timeout', async () => {
    const started = performance.now();
    const { open } = fakeConnect();

    expect(await probePort('192.0.2.1', 9, 50, open)).toEqual({
      kind: 'silent',
    });
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
    expect(await probe).toEqual({ kind: 'connected' });
    expect(calls).toEqual(['connect sent', 'timeout armed']);
  });

  it('probes again while the answer is silence, up to the attempts given', async () => {
    const { open, sockets } = fakeConnect();

    expect(await probeUntilAnswered('192.0.2.1', 9, 3, 20, open)).toEqual({
      kind: 'silent',
    });
    expect(sockets).toHaveLength(3);
  });

  it('stops probing once an attempt gets an answer', async () => {
    const { open, sockets } = fakeConnect(1);

    expect(await probeUntilAnswered('192.0.2.1', 9, 3, 20, open)).toEqual({
      kind: 'connected',
    });
    expect(sockets).toHaveLength(2);
  });
});

describe('a failed connect', () => {
  it.each([
    ['ECONNREFUSED', { kind: 'refused' }],
    ['EHOSTUNREACH', { kind: 'unreachable', code: 'EHOSTUNREACH' }],
    ['ENETUNREACH', { kind: 'unreachable', code: 'ENETUNREACH' }],
    ['ETIMEDOUT', { kind: 'unreachable', code: 'ETIMEDOUT' }],
    ['ENETDOWN', { kind: 'unreachable', code: 'ENETDOWN' }],
    ['EADDRNOTAVAIL', { kind: 'unreachable', code: 'EADDRNOTAVAIL' }],
    ['EACCES', { kind: 'unreachable', code: 'EACCES' }],
    ['EPERM', { kind: 'unreachable', code: 'EPERM' }],
  ])('maps %s to %j', async (code, expected) => {
    expect(probeFromError(Object.assign(new Error(code), { code }))).toEqual(
      expected,
    );
    expect(await probePort('192.0.2.1', 9, 20, failingConnect(code))).toEqual(
      expected,
    );
  });

  it('maps an error without a code to unreachable', () => {
    expect(probeFromError(new Error('boom'))).toEqual({
      kind: 'unreachable',
      code: 'UNKNOWN',
    });
  });

  it('does not probe again after an unreachable answer', async () => {
    let opened = 0;
    const open: Connect = (target) => {
      opened++;
      return failingConnect('EHOSTUNREACH')(target);
    };

    expect(await probeUntilAnswered('192.0.2.1', 9, 3, 20, open)).toEqual({
      kind: 'unreachable',
      code: 'EHOSTUNREACH',
    });
    expect(opened).toBe(1);
  });
});
