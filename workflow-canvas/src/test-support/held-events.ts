// SPDX-License-Identifier: Apache-2.0
import type { Scheduler } from '../execution/core/ports';
import {
  REQUEST_LIMIT_MS,
  type EventsReply,
  type ReadEvents,
} from '../run-client/follow-run-events';
import { RUN_TICK_MS } from '../run-view/use-run-clock';

/**
 * A scheduler for a test that follows a run. The limit of a long-poll call
 * and the tick of the run clock are held until the test ends them, and every
 * other wait, such as a back-off, ends at once, so the test moves on by
 * answering calls. `passSecond` ends the waits of the run clock, as real time
 * does.
 */
export class EventWaits implements Scheduler {
  private readonly ticks = new Set<() => void>();

  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (ms !== REQUEST_LIMIT_MS && ms !== RUN_TICK_MS) return Promise.resolve();
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const held = ms === RUN_TICK_MS ? this.ticks : undefined;
      held?.add(resolve);
      signal.addEventListener(
        'abort',
        () => {
          held?.delete(resolve);
          resolve();
        },
        { once: true },
      );
    });
  }

  /** How many ticks of the run clock are waiting. */
  get pendingTicks(): number {
    return this.ticks.size;
  }

  /** Ends the waits of the run clock, as half a second of real time does. */
  passSecond(): void {
    const ending = [...this.ticks];
    this.ticks.clear();
    for (const end of ending) end();
  }
}

/**
 * The reads of `GET /api/runs/{id}/events` for one session, each held until
 * the test answers it. A call rejects when its signal aborts, as `fetch`
 * does, and `calls` counts the ones made.
 */
export class HeldEvents {
  /** The run id and `after` of each call made, in order. */
  readonly calls: { runId: string; after: number }[] = [];
  private readonly held: ((reply: EventsReply) => void)[] = [];
  private readonly dropped: ((error: Error) => void)[] = [];

  readonly readEvents: ReadEvents = (runId, after, _wait, signal) => {
    this.calls.push({ runId, after });
    return new Promise<EventsReply>((resolve, reject) => {
      this.held.push(resolve);
      this.dropped.push(reject);
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
  };

  /** Whether a call is waiting for an answer. */
  get waiting(): boolean {
    return this.held.length > 0;
  }

  /** Answers the oldest call with the body and status. */
  answer(body: unknown, status = 200): void {
    const resolve = this.held.shift();
    this.dropped.shift();
    if (!resolve) throw new Error('No call is waiting.');
    resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
  }

  /** Fails the oldest call, as a server that is gone does. */
  drop(): void {
    const reject = this.dropped.shift();
    this.held.shift();
    if (!reject) throw new Error('No call is waiting.');
    reject(new TypeError('network error'));
  }
}

/** One `stage_state` event of a stage that is at work. */
export const running = (seq: number, stage: string) => ({
  seq,
  type: 'stage_state',
  stage,
  status: 'running',
});

/** One `stage_state` event of a stage that passed. */
export const passed = (seq: number, stage: string) => ({
  seq,
  type: 'stage_state',
  stage,
  status: 'passed',
});

/** One `stage_state` event of a stage that stopped the run. */
export const blocked = (seq: number, stage: string, reason: string) => ({
  seq,
  type: 'stage_state',
  stage,
  status: 'blocked',
  reason,
});

/** The `run_finished` event of a run. */
export const finished = (
  seq: number,
  status: 'passed' | 'halted',
  exitCode = status === 'passed' ? 0 : 1,
) => ({
  seq,
  type: 'run_finished',
  at: '2026-10-24T04:12:05Z',
  status,
  exit_code: exitCode,
});

/** An answer of `GET /api/runs/{id}/events` that carries the events. */
export function eventsAnswer(
  events: readonly { seq: number }[],
  { done = false } = {},
) {
  return {
    events,
    next: events.at(-1)?.seq ?? 0,
    finished: done,
  };
}
