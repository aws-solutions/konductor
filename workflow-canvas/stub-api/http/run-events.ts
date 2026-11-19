// SPDX-License-Identifier: Apache-2.0
import type { Clock } from '../core/clock.ts';
import type { RunEventsPage, WorkflowApi } from '../core/workflow-api.ts';
import { wholeNumber } from './queries.ts';

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
