// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../execution/core/ports';
import {
  REQUEST_LIMIT_MS,
  runEventsPath,
  type EventsReply,
  type ReadEvents,
} from './follow-run-events';
import { useFollowRun, type FollowRunInput } from './use-follow-run';

const settle = () => act(async () => {});

/**
 * The reads of one session, whose every call waits until the test answers
 * it. A call rejects when its signal aborts, as `fetch` does. `log` may be
 * shared by two sessions, to tell the order of their calls.
 */
class HeldSession {
  readonly paths: string[] = [];
  inFlight = 0;
  mostInFlight = 0;
  private held: {
    resolve: (reply: EventsReply) => void;
    reject: (error: Error) => void;
  }[] = [];

  constructor(
    private readonly name = 'session',
    readonly log: string[] = [],
  ) {}

  readonly readEvents: ReadEvents = (runId, after, wait, signal) => {
    const path = runEventsPath(runId, after, wait);
    this.paths.push(path);
    this.log.push(`${this.name} reads ${runId} after ${after}`);
    this.inFlight += 1;
    this.mostInFlight = Math.max(this.mostInFlight, this.inFlight);
    let settled = false;
    return new Promise<EventsReply>((resolve, reject) => {
      this.held.push({ resolve, reject });
      signal.addEventListener(
        'abort',
        () => {
          if (settled) return;
          this.log.push(`${this.name} aborted`);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    }).finally(() => {
      settled = true;
      this.inFlight -= 1;
    });
  };

  async answer(body: unknown, status = 200): Promise<void> {
    const call = this.held.shift();
    if (!call) throw new Error('No call is waiting.');
    call.resolve({
      ok: status === 200,
      status,
      json: () => Promise.resolve(body),
    });
    await settle();
  }

  async drop(): Promise<void> {
    this.held.shift()?.reject(new TypeError('network error'));
    await settle();
  }
}

// The limit of a call never passes; every other wait, such as a back-off,
// ends at once, so a test moves on by answering calls.
const scheduler: Scheduler = {
  wait: (ms, signal) =>
    new Promise((resolve) => {
      if (ms !== REQUEST_LIMIT_MS || signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
};

const at = '2026-10-24T04:12:05Z';
const stageState = (seq: number, stage: string, status: string) => ({
  seq,
  run_id: 'r1',
  at,
  type: 'stage_state',
  stage,
  status,
});
const finishedEvent = (seq: number) => ({
  seq,
  run_id: 'r1',
  at,
  type: 'run_finished',
  status: 'passed',
  exit_code: 0,
});
const page = (events: { seq: number }[], finished = false) => ({
  events,
  next: events.at(-1)?.seq ?? 0,
  finished,
});

function renderFollow(
  session: HeldSession,
  input: Partial<FollowRunInput> = {},
) {
  return renderHook((props: Partial<FollowRunInput>) =>
    useFollowRun({
      readEvents: session.readEvents,
      scheduler,
      now: () => 0,
      runId: 'r1',
      order: ['draft', 'review'],
      ...input,
      ...props,
    }),
  );
}

const pathRun = (path: string | undefined) => path?.split('/')[3];

describe('useFollowRun', () => {
  it('is idle with no run id or no session, and reads nothing', async () => {
    const session = new HeldSession();
    const noRun = renderFollow(session, { runId: undefined });
    const noSession = renderFollow(session, { readEvents: undefined });
    await settle();

    expect(noRun.result.current).toEqual({ status: { kind: 'idle' } });
    expect(noSession.result.current).toEqual({ status: { kind: 'idle' } });
    expect(session.paths).toEqual([]);
  });

  it('follows a run to its end', async () => {
    const session = new HeldSession();
    const { result } = renderFollow(session);
    await settle();

    expect(result.current.status).toEqual({ kind: 'following' });
    expect(result.current.run?.stages.map((s) => s.status)).toEqual([
      'pending',
      'pending',
    ]);

    await session.answer(page([stageState(1, 'draft', 'running')]));
    expect(result.current.status).toEqual({ kind: 'following' });
    expect(result.current.run?.stages[0]?.status).toBe('running');

    await session.answer(
      page(
        [
          stageState(2, 'draft', 'passed'),
          stageState(3, 'review', 'passed'),
          finishedEvent(4),
        ],
        true,
      ),
    );
    expect(result.current.status).toEqual({ kind: 'finished' });
    expect(result.current.run?.outcome).toEqual({
      status: 'passed',
      exitCode: 0,
    });
  });

  it('starts again from the first event when the run id changes, after the old follower ends', async () => {
    const session = new HeldSession();
    const { result, rerender } = renderFollow(session);
    await settle();
    await session.answer(page([stageState(1, 'draft', 'running')]));

    rerender({ runId: 'r2' });
    await settle();

    expect(result.current.status).toEqual({ kind: 'following' });
    expect(result.current.run?.stages[0]?.status).toBe('pending');
    expect(session.paths.map(pathRun)).toEqual(['r1', 'r1', 'r2']);
    expect(session.paths.at(-1)).toContain('after=0');
    expect(session.mostInFlight).toBe(1);
  });

  it('keeps no update of the old run once the id has changed', async () => {
    const session = new HeldSession();
    const { result, rerender } = renderFollow(session);
    await settle();
    rerender({ runId: 'r2' });
    await settle();
    await session.answer(page([stageState(1, 'draft', 'blocked')]));

    expect(result.current.run?.stages[0]?.status).toBe('pending');
  });

  it('aborts the old follower first for a new session, and reads the next events through the new one', async () => {
    const log: string[] = [];
    const first = new HeldSession('first', log);
    const second = new HeldSession('second', log);
    const { result, rerender } = renderFollow(first);
    await settle();
    await first.answer(page([stageState(1, 'draft', 'running')]));

    rerender({ readEvents: second.readEvents });
    await settle();

    expect(log).toEqual([
      'first reads r1 after 0',
      'first reads r1 after 1',
      'first aborted',
      'second reads r1 after 0',
    ]);
    expect(first.inFlight).toBe(0);
    expect(result.current.run?.stages[0]?.status).toBe('pending');

    await second.answer(page([finishedEvent(1)], true));
    expect(result.current.status).toEqual({ kind: 'finished' });
  });

  it('does not restart for a new clock with the same session', async () => {
    const session = new HeldSession();
    const { rerender } = renderFollow(session);
    await settle();
    rerender({ scheduler: { ...scheduler }, now: () => 1 });
    await settle();

    expect(session.paths).toHaveLength(1);
  });

  it('starts again when the stage order changes', async () => {
    const session = new HeldSession();
    const { result, rerender } = renderFollow(session);
    await settle();
    rerender({ order: ['draft'] });
    await settle();

    expect(result.current.run?.stages.map((s) => s.name)).toEqual(['draft']);
    expect(session.paths).toHaveLength(2);
  });

  it('aborts on unmount, and gives no update after it', async () => {
    const session = new HeldSession();
    const { result, unmount } = renderFollow(session);
    await settle();
    const before = result.current;
    unmount();
    await settle();

    expect(session.inFlight).toBe(0);
    expect(result.current).toBe(before);
    expect(session.paths).toHaveLength(1);
  });

  it('keeps following after a failed call, then reaches the end', async () => {
    const session = new HeldSession();
    const { result } = renderFollow(session);
    await settle();
    await session.drop();

    expect(result.current.status).toEqual({ kind: 'following' });
    await session.answer(page([finishedEvent(1)], true));
    expect(result.current.status).toEqual({ kind: 'finished' });
    expect(session.paths).toHaveLength(2);
  });

  it('says why following failed, and recovers with the next run id', async () => {
    const session = new HeldSession();
    const { result, rerender } = renderFollow(session);
    await settle();
    await session.answer({ error: 'There is no run with this id.' }, 404);

    expect(result.current.status).toEqual({
      kind: 'failed',
      message: 'There is no run with this id.',
    });

    rerender({ runId: 'r2' });
    await settle();
    expect(result.current.status).toEqual({ kind: 'following' });
    await session.answer(page([finishedEvent(1)], true));
    expect(result.current.status).toEqual({ kind: 'finished' });
  });

  it('says the session is lost on a 401, and reads no more', async () => {
    const session = new HeldSession();
    const { result } = renderFollow(session);
    await settle();
    await session.answer({ error: 'The session is not known.' }, 401);

    expect(result.current.status).toEqual({
      kind: 'session_lost',
      message: 'The session is not known.',
    });
    expect(session.paths).toHaveLength(1);
  });
});
