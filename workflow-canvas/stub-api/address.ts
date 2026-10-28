// SPDX-License-Identifier: Apache-2.0
import { ConfigError } from './config-error.ts';

/** The stub listens here and nowhere else. */
export const LOOPBACK = '127.0.0.1';
/** The port of the server URL in the contract. */
export const DEFAULT_PORT = 5174;
/** The port of the Vite dev server, which proxies `/api` to the stub. */
export const DEV_PAGE_PORT = 5173;

/** A `STUB_PORT` value that is not a port number. */
export class StubPortError extends ConfigError {
  constructor(value: string) {
    super(
      `STUB_PORT=${JSON.stringify(value)} is not usable: ` +
        'use a whole number from 1 to 65535, or unset it for the default.',
    );
    this.name = 'StubPortError';
  }
}

/**
 * The port of the stub: `STUB_PORT` if it is set, else the default. An empty
 * value counts as unset. Throws `StubPortError` for anything but 1 to 65535.
 */
export function stubPort(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.STUB_PORT;
  if (!value) return DEFAULT_PORT;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new StubPortError(value);
  return port;
}

/**
 * The origin of a server on the loopback address, as a browser writes it:
 * the default port of the scheme (80) is left out.
 */
export function originOf(port: number): string {
  return new URL(`http://${LOOPBACK}:${port}`).origin;
}

/** The port an http(s) origin names, with the scheme's default if it has none. */
export function portOf(origin: string): number {
  const url = new URL(origin);
  return Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
}
