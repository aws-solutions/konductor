// SPDX-License-Identifier: Apache-2.0
import type { ServerResponse } from 'node:http';
import { API_VERSION } from '../core/contract.ts';
import { ApiError, type ErrorCode } from '../core/errors.ts';
import type { Reply } from './routes.ts';

/** The status that goes with each error code. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  bad_name: 400,
  bad_hash: 400,
  unauthorized: 401,
  invalid_code: 401,
  forbidden_host: 403,
  forbidden_origin: 403,
  read_only_workflow: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  already_running: 409,
  harness_unavailable: 409,
  trust_required: 409,
  too_large: 413,
  invalid_workflow: 422,
  bad_params: 422,
  io_error: 500,
};

/** An error response, with the fields that come with its code. */
export function errorReply(error: ApiError): Reply {
  return {
    status: STATUS_BY_CODE[error.code],
    body: { error: error.message, code: error.code, ...error.extra },
  };
}

/** The answer to anything that is not an `ApiError`: a fault of the stub. */
export function faultReply(): Reply {
  const message = 'The server could not read or write its files.';
  return errorReply(new ApiError('io_error', message));
}

/** Writes a reply with the headers that every response carries. */
export function send(res: ServerResponse, reply: Reply): void {
  res.writeHead(reply.status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Konductor-Api': String(API_VERSION),
    ...reply.headers,
  });
  res.end(JSON.stringify(reply.body));
}
