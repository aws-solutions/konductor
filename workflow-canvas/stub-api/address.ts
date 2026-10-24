// SPDX-License-Identifier: Apache-2.0

/** The stub listens here and nowhere else. */
export const LOOPBACK = '127.0.0.1';
/** The port of the server URL in the contract. */
export const DEFAULT_PORT = 5174;
/** The port of the Vite dev server, which proxies `/api` to the stub. */
export const DEV_PAGE_PORT = 5173;

/** The port of the stub: `STUB_PORT` if it is set, else the default. */
export function stubPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.STUB_PORT ?? DEFAULT_PORT);
}

/** The origin of a server on the loopback address. */
export function originOf(port: number): string {
  return `http://${LOOPBACK}:${port}`;
}
