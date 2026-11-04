// SPDX-License-Identifier: Apache-2.0
import { connect, type Socket } from 'node:net';

/** How long a probe waits; an address that drops packets never answers. */
export const PROBE_TIMEOUT_MS = 500;

/**
 * What a probe saw. `refused` means the host answered with a reset
 * (ECONNREFUSED), the only proof that nothing listens there. `unreachable`
 * means the connect failed some other way (no route, no permission) and carries
 * the error code; it says nothing about whether anything listens.
 */
export type Probe =
  | { kind: 'connected' }
  | { kind: 'refused' }
  | { kind: 'unreachable'; code: string }
  | { kind: 'silent' };

/** Maps a socket error to the probe result it proves. */
export function probeFromError(error: NodeJS.ErrnoException): Probe {
  return error.code === 'ECONNREFUSED'
    ? { kind: 'refused' }
    : { kind: 'unreachable', code: error.code ?? 'UNKNOWN' };
}

/** The part of `net.connect` a probe uses, so a test can stand in for it. */
export type Connect = (options: {
  host: string;
  port: number;
}) => Pick<Socket, 'once' | 'destroy' | 'setTimeout'>;

/**
 * Tries a TCP connection to `host:port`. The timeout is armed only after the
 * connect has been sent, and judged one loop turn late, so an event loop that
 * stalled past `timeoutMs` still delivers a connection that was already made
 * instead of reporting silence.
 */
export function probePort(
  host: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
  open: Connect = connect,
): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = open({ host, port });
    // For an IP host the connect goes out on the next tick; a timer started
    // before it would count a stall ahead of the connect as silence.
    process.nextTick(() => socket.setTimeout(timeoutMs));
    const settle = (result: Probe) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => settle({ kind: 'connected' }));
    socket.once('error', (error) => settle(probeFromError(error)));
    socket.once('timeout', () =>
      setImmediate(() => settle({ kind: 'silent' })),
    );
  });
}

/**
 * Probes again while the answer is silence, so a stalled or busy machine is not
 * mistaken for an address that nobody can reach. Returns the last probe.
 */
export async function probeUntilAnswered(
  host: string,
  port: number,
  attempts = 3,
  timeoutMs = PROBE_TIMEOUT_MS,
  open: Connect = connect,
): Promise<Probe> {
  let result: Probe = { kind: 'silent' };
  for (let i = 0; i < attempts && result.kind === 'silent'; i++) {
    result = await probePort(host, port, timeoutMs, open);
  }
  return result;
}
