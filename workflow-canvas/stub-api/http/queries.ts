// SPDX-License-Identifier: Apache-2.0
import { ApiError } from '../core/errors.ts';

const WHOLE_NUMBER = /^(0|[1-9][0-9]{0,15})$/;

/**
 * A whole number from 0 to `max` in the query, or `undefined` when the key is
 * left out. A value given more than once, or one that is not such a number,
 * is a bad request.
 */
export function wholeNumber(
  query: URLSearchParams,
  key: string,
  max: number,
): number | undefined {
  const values = query.getAll(key);
  if (values.length === 0) return undefined;
  const [value] = values;
  const number =
    values.length === 1 && WHOLE_NUMBER.test(value ?? '') ? Number(value) : NaN;
  if (!(number <= max)) {
    throw new ApiError('bad_request', `\`${key}\` is not valid.`);
  }
  return number;
}

/** The most runs `GET /api/runs` returns, and how many when `limit` is left out. */
export const MAX_RUNS = 200;
export const DEFAULT_RUNS = 50;

/** The `limit` of `GET /api/runs`: 1 to `MAX_RUNS`. */
export function readLimit(query: URLSearchParams): number {
  const limit = wholeNumber(query, 'limit', MAX_RUNS) ?? DEFAULT_RUNS;
  if (limit < 1) throw new ApiError('bad_request', '`limit` is not valid.');
  return limit;
}
