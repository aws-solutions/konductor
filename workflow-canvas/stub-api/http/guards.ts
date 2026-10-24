// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage } from 'node:http';
import { ApiError } from '../core/errors.ts';

/** The `Host` of the request, if it is this server on a loopback name. */
export function requireLocalHost(req: IncomingMessage, port: number): string {
  const host = req.headers.host?.toLowerCase();
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return host;
  throw new ApiError(
    'forbidden_host',
    'The Host header does not match this server.',
  );
}

/**
 * A PUT or POST must carry this server's own `Origin`. A GET may leave it out,
 * but a header it does carry must not point elsewhere.
 */
export function requireOwnOrigin(
  req: IncomingMessage,
  host: string,
  method: string,
): void {
  const { origin } = req.headers;
  const site = req.headers['sec-fetch-site'];
  const own = `http://${host}`;
  const allowed =
    method === 'GET'
      ? (origin === undefined || origin === own) &&
        (site === undefined || site === 'same-origin' || site === 'none')
      : origin === own;
  if (!allowed) {
    throw new ApiError(
      'forbidden_origin',
      'The Origin header does not match this server.',
    );
  }
}

/** A body must be `application/json`, with no parameter or with UTF-8. */
export function requireJsonContentType(req: IncomingMessage): void {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;\s*charset=utf-8\s*)?$/i.test(type)) {
    throw new ApiError('bad_request', 'The request body is not valid.');
  }
}
