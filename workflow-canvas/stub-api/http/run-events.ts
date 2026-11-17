// SPDX-License-Identifier: Apache-2.0
import type { Clock } from '../core/clock.ts';
import { ApiError } from '../core/errors.ts';
import type { RunEventsPage, WorkflowApi } from '../core/workflow-api.ts';

/** The longest a long poll waits, in seconds. */
export const MAX_WAIT_SECONDS = 25;

/** Time for a long poll: a clock to read, and a way to wait on it. */
export interface Waiter {
  clock: Clock;
  /** Resolves after `ms` of the clock. */
  pause(ms: number): Promise<void>;
}

/** The query of `GET /api/runs/{id}/events`. */
export interface EventsQuery {
  after: number;
  waitMs: number;
}

const WHOLE_NUMBER = /^(0|[1-9][0-9]{0,15})$/;

// A value given more than once, or that is not a whole number in range, is a
// bad request. One that is left out takes its default.
function wholeNumber(
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

export function readEventsQuery(query: URLSearchParams): EventsQuery {
  const after = wholeNumber(query, 'after', Number.MAX_SAFE_INTEGER) ?? 0;
  const wait = wholeNumber(query, 'wait', MAX_WAIT_SECONDS) ?? 0;
  return { after, waitMs: wait * 1000 };
}

/**
 * Answers a long poll: the events after `after` at once if there are any or
 * the run has finished, and otherwise the first that happen within the wait.
 */
export async function followRunEvents(
  api: WorkflowApi,
  runId: string,
  { after, waitMs }: EventsQuery,
  { clock, pause }: Waiter,
): Promise<Omit<RunEventsPage, 'nextAt'>> {
  const deadline = clock.now() + waitMs;
  for (;;) {
    const { nextAt, ...page } = api.runEvents(runId, after);
    const now = clock.now();
    if (page.events.length > 0 || page.finished || now >= deadline) {
      return page;
    }
    await pause(Math.min(nextAt ?? deadline, deadline) - now);
  }
}
