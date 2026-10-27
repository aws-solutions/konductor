// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '../../api/types';
import { FakeScheduler } from '../../test-support/fake-scheduler';
import { helloRun } from '../../test-support/fixtures';
import type { ExecutionEvent } from './execution-state';
import { POLL_INTERVAL_MS, resumeRun } from './follow-run';
import type { RunPort } from './ports';

const RUN_ID = helloRun(0).runId;

// Lets the loop run until it waits for the scheduler or ends.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function setup(readings: (RunView | Error)[]) {
  const queue = [...readings];
  const runs: RunPort = {
    start: vi.fn(),
    get: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('No reading left.');
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const scheduler = new FakeScheduler();
  const events: ExecutionEvent[] = [];
  const abort = new AbortController();
  const done = resumeRun({
    runs,
    scheduler,
    runId: RUN_ID,
    emit: (event) => events.push(event),
    signal: abort.signal,
  });
  return { runs, scheduler, events, abort, done };
}

describe('resumeRun', () => {
  it('joins a run that is still running, with what it read, and goes on reading it', async () => {
    const { runs, scheduler, events, done } = setup([helloRun(1), helloRun(2)]);

    await settle();
    expect(events).toEqual([
      { type: 'start' },
      { type: 'started', runId: RUN_ID, joined: true },
      { type: 'snapshot', run: helloRun(1) },
    ]);
    expect(scheduler.waits).toEqual([POLL_INTERVAL_MS]);

    scheduler.tick();
    await done;

    expect(runs.get).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ type: 'snapshot', run: helloRun(2) });
  });

  it('says nothing about a run that has ended', async () => {
    const { events, done } = setup([helloRun(2)]);

    await done;

    expect(events).toEqual([]);
  });

  it('says nothing when the run cannot be read, as after the server started again', async () => {
    const { runs, events, done } = setup([new Error('Gone.')]);

    await done;

    expect(events).toEqual([]);
    expect(runs.get).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the server answers with another run', async () => {
    const other = { ...helloRun(1), runId: 'another-run' };
    const { events, done } = setup([other]);

    await done;

    expect(events).toEqual([]);
  });

  it('says nothing once it is aborted', async () => {
    const { events, abort, done } = setup([helloRun(1)]);
    abort.abort();

    await done;

    expect(events).toEqual([]);
  });

  it('ends the join with a failure when the run can no longer be read', async () => {
    const { scheduler, events, done } = setup([
      helloRun(1),
      new Error('Down.'),
      new Error('Down.'),
      new Error('Down.'),
    ]);

    await settle();
    for (let turn = 0; turn < 4; turn += 1) {
      scheduler.tick();
      await settle();
    }
    await done;

    expect(events.at(-1)).toEqual({ type: 'failed', message: 'Down.' });
  });
});
