// SPDX-License-Identifier: Apache-2.0
import { ConfigError } from './config-error.ts';

/** The stub listens here and nowhere else. */
export const LOOPBACK = '127.0.0.1';
/** The port of the server URL in the contract. */
export const DEFAULT_PORT = 5174;
/** The port of the built page that Playwright serves with `vite preview`. */
export const DEFAULT_APP_PORT = 4173;
/** The port of the Vite dev server, which proxies `/api` to the stub. */
export const DEV_PAGE_PORT = 5173;

/** A port setting that is not a port number. */
export class PortSettingError extends ConfigError {
  constructor(variable: string, value: string) {
    super(
      `${variable}=${JSON.stringify(value)} is not usable: ` +
        'use a whole number from 1 to 65535, or unset it for the default.',
    );
    this.name = 'PortSettingError';
  }
}

/** A `STUB_PORT` value that is not a port number. */
export class StubPortError extends PortSettingError {
  constructor(value: string) {
    super('STUB_PORT', value);
    this.name = 'StubPortError';
  }
}

/** A `WC_APP_PORT` value that is not a port number. */
export class AppPortError extends PortSettingError {
  constructor(value: string) {
    super('WC_APP_PORT', value);
    this.name = 'AppPortError';
  }
}

/** The port in `value`, an empty value counting as `fallback`. */
function portOrFallback(
  value: string | undefined,
  fallback: number,
  error: new (value: string) => PortSettingError,
): number {
  if (!value) return fallback;
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new error(value);
  return port;
}

/**
 * The port of the stub: `STUB_PORT` if it is set, else the default. An empty
 * value counts as unset. Throws `StubPortError` for anything but 1 to 65535.
 */
export function stubPort(env: NodeJS.ProcessEnv = process.env): number {
  return portOrFallback(env.STUB_PORT, DEFAULT_PORT, StubPortError);
}

/**
 * The port of the built page that Playwright serves: `WC_APP_PORT` if it is
 * set, else the default. Throws `AppPortError` for anything but 1 to 65535.
 */
export function appPort(env: NodeJS.ProcessEnv = process.env): number {
  return portOrFallback(env.WC_APP_PORT, DEFAULT_APP_PORT, AppPortError);
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
