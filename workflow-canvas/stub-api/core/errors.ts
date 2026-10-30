// SPDX-License-Identifier: Apache-2.0

/** The error codes of the API contract. */
export const ERROR_CODES = [
  'bad_request',
  'bad_name',
  'bad_hash',
  'unauthorized',
  'invalid_code',
  'forbidden_host',
  'forbidden_origin',
  'read_only_workflow',
  'not_found',
  'method_not_allowed',
  'conflict',
  'already_running',
  'harness_unavailable',
  'trust_required',
  'too_large',
  'invalid_workflow',
  'bad_params',
  'io_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** A refusal that the HTTP adapter turns into an error response. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  /** Fields that come with the code, such as `current_hash`. */
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    message: string,
    extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.extra = extra;
  }
}

/** The 400 for a body, header or field that is not what the contract allows. */
export function badRequest(): ApiError {
  return new ApiError('bad_request', 'The request body is not valid.');
}

/** The 400 for a workflow name that does not match the name pattern. */
export function badName(): ApiError {
  return new ApiError('bad_name', 'The workflow name is not valid.');
}
