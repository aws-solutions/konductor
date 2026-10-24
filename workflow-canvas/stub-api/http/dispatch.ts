// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage } from 'node:http';
import { ApiError } from '../core/errors.ts';
import { readJsonBody } from './body.ts';
import {
  requireJsonContentType,
  requireLocalHost,
  requireOwnOrigin,
} from './guards.ts';
import { errorReply } from './respond.ts';
import type { Reply, Route } from './routes.ts';
import type { SessionGate } from './session.ts';

export interface Dispatcher {
  routes: Route[];
  session: SessionGate;
  /** The port the server listens on, which a `Host` must name. */
  port(): number;
}

/**
 * Answers a request. The checks come in the order that the contract fixes:
 * `Host`, path and method, `Origin`, the token, then the body.
 */
export async function dispatch(
  req: IncomingMessage,
  { routes, session, port }: Dispatcher,
): Promise<Reply> {
  const host = requireLocalHost(req, port());
  const method = req.method ?? 'GET';
  const { path, query } = splitTarget(req.url ?? '/');
  const match = matchRoute(routes, path);
  if (!match) throw new ApiError('not_found', 'There is no such path.');
  const operation = match.route.operations[method];
  if (!operation) return methodNotAllowed(match.route);
  requireOwnOrigin(req, host, method);
  if (operation.secured) session.authorize(req.headers.authorization);
  const body = method === 'GET' ? undefined : await readBody(req);
  return operation.handle({ query, params: match.params, body });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  requireJsonContentType(req);
  return readJsonBody(req);
}

// The request target is a path and a query; the fragment never arrives.
function splitTarget(target: string) {
  const at = target.indexOf('?');
  return {
    path: at < 0 ? target : target.slice(0, at),
    query: new URLSearchParams(at < 0 ? '' : target.slice(at + 1)),
  };
}

function matchRoute(routes: Route[], path: string) {
  for (const route of routes) {
    const found = route.pattern.exec(path);
    if (found) return { route, params: found.slice(1) };
  }
  return undefined;
}

function methodNotAllowed(route: Route): Reply {
  const error = new ApiError(
    'method_not_allowed',
    'This method is not allowed.',
  );
  return {
    ...errorReply(error),
    headers: { Allow: Object.keys(route.operations).join(', ') },
  };
}
