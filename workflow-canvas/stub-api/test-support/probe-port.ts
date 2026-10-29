// SPDX-License-Identifier: Apache-2.0
import { connect, type Socket } from 'node:net';

/** How long a probe waits; an address that drops packets never answers. */
export const PROBE_TIMEOUT_MS = 500;

/**
 * What a probe saw: a connection was accepted, the connection failed at once
 * (refused or unreachable), or nothing answered before the timeout.
 */
export type Probe = 'connected' | 'refused' | 'silent';

/** The part of `net.connect` a probe uses, so a test can stand in for it. */
export type Connect = (options: {
  host: string;
  port: number;
  timeout: number;
}) => Pick<Socket, 'once' | 'destroy'>;

/**
 * Tries a TCP connection to `host:port`. A timeout is judged one loop turn
 * late, so an event loop that stalled past `timeoutMs` still delivers a
 * connection that was already made instead of reporting silence.
 */
export function probePort(
  host: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
  open: Connect = connect,
): Promise<Probe> {
  return new Promise((resolve) => {
    const socket = open({ host, port, timeout: timeoutMs });
    const settle = (result: Probe) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => settle('connected'));
    socket.once('error', () => settle('refused'));
    socket.once('timeout', () => setImmediate(() => settle('silent')));
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
  let result: Probe = 'silent';
  for (let i = 0; i < attempts && result === 'silent'; i++) {
    result = await probePort(host, port, timeoutMs, open);
  }
  return result;
}
