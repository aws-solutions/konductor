// SPDX-License-Identifier: Apache-2.0
import { connect } from 'node:net';

/** How long a probe waits; an address that drops packets never answers. */
export const PROBE_TIMEOUT_MS = 500;

/**
 * Whether something accepts a TCP connection at `host:port`. A refusal, an
 * unreachable network and a silence past `timeoutMs` all count as `false`.
 */
export function canConnect(
  host: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    const settle = (connected: boolean) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.once('timeout', () => settle(false));
  });
}
