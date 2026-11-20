// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../execution/core/ports';
import {
  REQUEST_LIMIT_MS,
  type EventsReply,
  type RunEventsPorts,
  type SendRequest,
} from './follow-run-events';
import { useFollowRun, type FollowRunInput } from './useFollowRun';

const settle = () => act(async () => {});

/**
 * A server whose every call waits until the test answers it. A call rejects
 * when its signal aborts, as `fetch` does.
 */
class HeldServer {
  readonly paths: string[] = [];
  inFlight = 0;
  mostInFlight = 0;
  private held: {
    resolve: (reply: EventsReply) => void;
    reject: (error: Error) => void;
  }[] = [];

  readonly send: SendRequest = (path, { signal }) => {
    this.paths.push(path);
    this.inFlight += 1;
    this.mostInFlight = Math.max(this.mostInFlight, this.inFlight);
    return new Promise<EventsReply>((resolve, reject) => {
      this.held.push({ resolve, reject });
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    }).finally(() => {
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

function portsOf(server: HeldServer): RunEventsPorts {
  return { send: server.send, scheduler, now: () => 0 };
}

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

function renderFollow(server: HeldServer, input: Partial<FollowRunInput> = {}) {
  const ports = portsOf(server);
  return renderHook((props: Partial<FollowRunInput>) =>
    useFollowRun({
      ports,
      token: 'tok',
      runId: 'r1',
      order: ['draft', 'review'],
      ...input,
      ...props,
    }),
  );
}

const pathRun = (path: string | undefined) => path?.split('/')[3];

describe('useFollowRun', () => {
  it('is idle with no run id or no token, and calls nothing', async () => {
    const server = new HeldServer();
    const noRun = renderFollow(server, { runId: undefined });
    const noToken = renderFollow(server, { token: undefined });
    await settle();

    expect(noRun.result.current).toEqual({ status: { kind: 'idle' } });
    expect(noToken.result.current).toEqual({ status: { kind: 'idle' } });
    expect(server.paths).toEqual([]);
  });

  it('follows a run to its end', async () => {
    const server = new HeldServer();
    const { result } = renderFollow(server);
    await settle();

    expect(result.current.status).toEqual({ kind: 'following' });
    expect(result.current.run?.stages.map((s) => s.status)).toEqual([
      'pending',
      'pending',
    ]);

    await server.answer(page([stageState(1, 'draft', 'running')]));
    expect(result.current.status).toEqual({ kind: 'following' });
    expect(result.current.run?.stages[0]?.status).toBe('running');

    await server.answer(
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
    const server = new HeldServer();
    const { result, rerender } = renderFollow(server);
    await settle();
    await server.answer(page([stageState(1, 'draft', 'running')]));

    rerender({ runId: 'r2' });
    await settle();

    expect(result.current.status).toEqual({ kind: 'following' });
    expect(result.current.run?.stages[0]?.status).toBe('pending');
    expect(server.paths.map(pathRun)).toEqual(['r1', 'r1', 'r2']);
    expect(server.paths.at(-1)).toContain('after=0');
    expect(server.mostInFlight).toBe(1);
  });

  it('keeps no update of the old run once the id has changed', async () => {
    const server = new HeldServer();
    const { result, rerender } = renderFollow(server);
    await settle();
    rerender({ runId: 'r2' });
    await settle();
    await server.answer(page([stageState(1, 'draft', 'blocked')]));

    expect(result.current.run?.stages[0]?.status).toBe('pending');
  });

  it('does not restart for new ports with the same run', async () => {
    const server = new HeldServer();
    const { rerender } = renderFollow(server);
    await settle();
    rerender({ ports: portsOf(server) });
    await settle();

    expect(server.paths).toHaveLength(1);
  });

  it('starts again when the stage order changes', async () => {
    const server = new HeldServer();
    const { result, rerender } = renderFollow(server);
    await settle();
    rerender({ order: ['draft'] });
    await settle();

    expect(result.current.run?.stages.map((s) => s.name)).toEqual(['draft']);
    expect(server.paths).toHaveLength(2);
  });

  it('aborts on unmount, and gives no update after it', async () => {
    const server = new HeldServer();
    const { result, unmount } = renderFollow(server);
    await settle();
    const before = result.current;
    unmount();
    await settle();

    expect(server.inFlight).toBe(0);
    expect(result.current).toBe(before);
    expect(server.paths).toHaveLength(1);
  });

  it('keeps following after a failed call, then reaches the end', async () => {
    const server = new HeldServer();
    const { result } = renderFollow(server);
    await settle();
    await server.drop();

    expect(result.current.status).toEqual({ kind: 'following' });
    await server.answer(page([finishedEvent(1)], true));
    expect(result.current.status).toEqual({ kind: 'finished' });
    expect(server.paths).toHaveLength(2);
  });

  it('says why following failed, and recovers with the next run id', async () => {
    const server = new HeldServer();
    const { result, rerender } = renderFollow(server);
    await settle();
    await server.answer({ error: 'There is no run with this id.' }, 404);

    expect(result.current.status).toEqual({
      kind: 'failed',
      message: 'There is no run with this id.',
    });

    rerender({ runId: 'r2' });
    await settle();
    expect(result.current.status).toEqual({ kind: 'following' });
    await server.answer(page([finishedEvent(1)], true));
    expect(result.current.status).toEqual({ kind: 'finished' });
  });
});
