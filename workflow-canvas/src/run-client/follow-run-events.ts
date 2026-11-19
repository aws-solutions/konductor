// SPDX-License-Identifier: Apache-2.0
import { canRetryStatus } from '../api/api';
import type { Scheduler } from '../execution/core/ports';
import { applyRunEvents, type FollowedRun } from '../execution/core/run-follow';
import {
  parseRunEventsAnswer,
  type RunEventsAnswer,
} from './run-events-answer';

/** How long the server may hold a call open, in seconds. The contract allows 25. */
export const LONG_POLL_WAIT_S = 20;

/** How long one call may take before it is given up on, past the wait. */
export const REQUEST_LIMIT_MS = (LONG_POLL_WAIT_S + 10) * 1000;

/** The least time between two calls that bring nothing new. */
export const MIN_POLL_GAP_MS = 1000;

/** The wait after the first failed call. It doubles with each failure. */
export const RETRY_FIRST_MS = 1000;

/** The longest wait between two failed calls. */
export const RETRY_MAX_MS = 16_000;

/** How many calls in a row may fail before the follower gives up. */
export const MAX_FAILURES_IN_A_ROW = 8;

/**
 * How long the server keeps a finished run's console lines, from its
 * `run_finished`. The last read must come inside it to get them.
 */
export const CONSOLE_GRACE_MS = 60_000;

const UNREACHABLE =
  'The server did not answer. Check that it is still running.';
const UNREADABLE = 'The events of the run could not be read.';

/** What the follower reads of an HTTP reply. A `Response` is one. */
export interface EventsReply {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * Sends a `GET` to a path of the API and resolves to the reply, like
 * `fetch`. It must reject when its signal aborts, as `fetch` does.
 */
export type SendRequest = (
  path: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<EventsReply>;

/** The ports of the follower: the network and the clock. */
export interface RunEventsPorts {
  readonly send: SendRequest;
  readonly scheduler: Scheduler;
  /** The time now, in milliseconds. */
  readonly now: () => number;
}

/** What `followRunEvents` needs. */
export interface FollowEventsRequest {
  readonly ports: RunEventsPorts;
  readonly token: string;
  readonly runId: string;
  /** What is known of the run so far; its `next` is the first `after`. */
  readonly from: FollowedRun;
  /** Gets the run after each answer that brought events. Must not throw. */
  readonly onRun: (run: FollowedRun) => void;
  /** Aborting ends the follower at once, with no further `onRun`. */
  readonly signal: AbortSignal;
}

/**
 * How following ended, with what is known of the run. `finished` has no
 * `outcome` on the run when the server said the run ended but its
 * `run_finished` never came, so the caller reads the run instead.
 */
export type FollowEnd =
  | { readonly kind: 'finished'; readonly run: FollowedRun }
  | { readonly kind: 'aborted'; readonly run: FollowedRun }
  | {
      readonly kind: 'failed';
      readonly run: FollowedRun;
      readonly message: string;
    };

type Read =
  | { readonly kind: 'answer'; readonly answer: RunEventsAnswer }
  | { readonly kind: 'retry'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

function errorTextOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { error } = body as { error?: unknown };
  return typeof error === 'string' && error !== '' ? error : undefined;
}

async function bodyOrNothing(reply: EventsReply): Promise<unknown> {
  try {
    return await reply.json();
  } catch {
    return undefined;
  }
}

// Ends the call when `outer` aborts or the limit passes, and leaves no wait
// or listener behind.
async function withLimit<T>(
  scheduler: Scheduler,
  outer: AbortSignal,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (outer.aborted) stop();
  outer.addEventListener('abort', stop, { once: true });
  void scheduler.wait(REQUEST_LIMIT_MS, controller.signal).then(stop);
  try {
    return await call(controller.signal);
  } finally {
    stop();
    outer.removeEventListener('abort', stop);
  }
}

function failedReply(status: number, body: unknown): Read {
  const message = errorTextOf(body) ?? `The server answered ${status}.`;
  return canRetryStatus(status)
    ? { kind: 'retry', message }
    : { kind: 'refused', message };
}

async function readOnce(
  { ports, token, runId, signal }: FollowEventsRequest,
  after: number,
  wait: number,
): Promise<Read> {
  const path = `/api/runs/${encodeURIComponent(runId)}/events?after=${after}&wait=${wait}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    return await withLimit(ports.scheduler, signal, async (limited) => {
      const reply = await ports.send(path, { headers, signal: limited });
      if (!reply.ok)
        return failedReply(reply.status, await bodyOrNothing(reply));
      const answer = parseRunEventsAnswer(await reply.json());
      return answer
        ? { kind: 'answer', answer }
        : { kind: 'refused', message: UNREADABLE };
    });
  } catch {
    return { kind: 'retry', message: UNREACHABLE };
  }
}

function retryDelay(failures: number): number {
  return Math.min(RETRY_FIRST_MS * 2 ** (failures - 1), RETRY_MAX_MS);
}

/**
 * Follows the events of a run with the long poll of `GET /api/runs/{id}/events`
 * and folds each answer into the run with `applyRunEvents`. One call is in
 * flight at a time. A call that fails for a reason that can pass, such as no
 * answer or a 5xx, is tried again after a wait that doubles up to
 * `RETRY_MAX_MS`; any other failure ends the follower.
 *
 * Once `run_finished` is read the follower stops, as no event comes after
 * it. An answer that says the run has finished may still lack the last
 * events, as `finished` can be set before `run_finished` is in the answer.
 * So the follower then makes one more read, at once, while the server still
 * keeps the console lines, and stops after it.
 */
export async function followRunEvents(
  request: FollowEventsRequest,
): Promise<FollowEnd> {
  const { ports, onRun, signal } = request;
  let run = request.from;
  let after = run.next;
  let failures = 0;
  let lastReadBy: number | undefined;
  for (;;) {
    if (signal.aborted) return { kind: 'aborted', run };
    if (run.outcome) return { kind: 'finished', run };
    if (lastReadBy !== undefined && ports.now() >= lastReadBy) {
      return { kind: 'finished', run };
    }
    const started = ports.now();
    const read = await readOnce(
      request,
      after,
      lastReadBy === undefined ? LONG_POLL_WAIT_S : 0,
    );
    if (signal.aborted) return { kind: 'aborted', run };
    if (read.kind === 'refused') {
      return { kind: 'failed', run, message: read.message };
    }
    if (read.kind === 'retry') {
      failures += 1;
      if (failures >= MAX_FAILURES_IN_A_ROW) {
        return { kind: 'failed', run, message: read.message };
      }
      await ports.scheduler.wait(retryDelay(failures), signal);
      continue;
    }
    failures = 0;
    const { answer } = read;
    after = Math.max(after, answer.next);
    if (answer.events.length > 0) {
      run = applyRunEvents(run, answer.events);
      onRun(run);
    }
    if (lastReadBy !== undefined) return { kind: 'finished', run };
    if (answer.finished) {
      lastReadBy = ports.now() + CONSOLE_GRACE_MS;
    } else if (answer.events.length === 0) {
      const gap = MIN_POLL_GAP_MS - (ports.now() - started);
      if (gap > 0) await ports.scheduler.wait(gap, signal);
    }
  }
}
