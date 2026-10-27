// SPDX-License-Identifier: Apache-2.0
import type { ProxyOptions } from 'vite';
import { LOOPBACK } from './address.ts';

/**
 * Whether `origin` is the page of this dev or preview server: a loopback name
 * on the port the server listens on. `port` is the local port of the request.
 */
export function isDevPageOrigin(
  origin: string | undefined,
  port: number | undefined,
): boolean {
  if (origin === undefined || port === undefined) return false;
  return [LOOPBACK, 'localhost'].some(
    (host) => new URL(`http://${host}:${port}`).origin === origin,
  );
}

/**
 * The proxy of `/api` to `apiOrigin`. The API accepts only its own `Origin`,
 * so the page's own `Origin` becomes that one. Any other `Origin`, or none, goes
 * through unchanged and the API refuses it, so a page on another origin cannot
 * use this server to reach the API.
 */
export function apiProxy(apiOrigin: string): Record<string, ProxyOptions> {
  return {
    '/api': {
      target: apiOrigin,
      changeOrigin: true,
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          if (isDevPageOrigin(req.headers.origin, req.socket.localPort)) {
            proxyReq.setHeader('Origin', apiOrigin);
          }
        });
      },
    },
  };
}
