// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '../../api/types';
import { FakeScheduler } from '../../test-support/fake-scheduler';
import { helloRun } from '../../test-support/fixtures';
import type { ExecutionEvent } from './execution-state';
import {
  MAX_READ_FAILURES,
  POLL_INTERVAL_MS,
  startAndFollow,
} from './follow-run';
import { RunAlreadyActive, type RunPort } from './ports';

const RUN_ID = helloRun(0).runId;

// Lets the loop run until it waits for the scheduler or ends.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function setup(readings: (RunView | Error)[], start?: RunPort['start']) {
  const queue = [...readings];
  const runs: RunPort = {
    start: start ?? vi.fn().mockResolvedValue(RUN_ID),
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
  const done = startAndFollow({
    runs,
    scheduler,
    goal: 'Ship it',
    emit: (event) => events.push(event),
    signal: abort.signal,
  });
  return { runs, scheduler, events, abort, done };
}

describe('startAndFollow', () => {
  it('starts the run with the goal, then reads it at once', async () => {
    const { runs, events, done } = setup([helloRun(2)]);

    await done;

    expect(runs.start).toHaveBeenCalledWith('Ship it');
    expect(runs.get).toHaveBeenCalledWith(RUN_ID);
    expect(events).toEqual([
      { type: 'started', runId: RUN_ID },
      { type: 'snapshot', run: helloRun(2) },
    ]);
  });

  it('reads again after each wait of a second, until the run is no longer running', async () => {
    const { runs, scheduler, events, done } = setup([
      helloRun(0),
      helloRun(1),
      helloRun(2),
    ]);

    await settle();
    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(scheduler.waits).toEqual([POLL_INTERVAL_MS]);

    scheduler.tick();
    await settle();
    expect(runs.get).toHaveBeenCalledTimes(2);

    scheduler.tick();
    await done;

    expect(runs.get).toHaveBeenCalledTimes(3);
    expect(scheduler.waits).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'snapshot',
      'snapshot',
      'snapshot',
    ]);
  });

  it('polls once a second', () => {
    expect(POLL_INTERVAL_MS).toBe(1000);
  });

  it('stops after a halted run', async () => {
    const halted = helloRun(0, { blockedAt: 0 });
    const { runs, scheduler, done } = setup([halted]);

    await done;

    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(scheduler.waits).toEqual([]);
  });

  it('does not wait before the first reading', async () => {
    const { scheduler, done } = setup([helloRun(2)]);

    await done;

    expect(scheduler.waits).toEqual([]);
  });

  it('ends with one failed event when the run does not start', async () => {
    const { runs, events, done } = setup(
      [],
      vi.fn().mockRejectedValue(new Error('A run is already active.')),
    );

    await done;

    expect(runs.get).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'failed', message: 'A run is already active.' },
    ]);
  });

  it('reads again after a failed reading, and goes on when the next one works', async () => {
    const { runs, scheduler, events, done } = setup([
      new Error('The server did not answer.'),
      helloRun(2),
    ]);

    await settle();
    expect(scheduler.waits).toEqual([POLL_INTERVAL_MS]);
    scheduler.tick();
    await done;

    expect(runs.get).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      { type: 'started', runId: RUN_ID },
      { type: 'snapshot', run: helloRun(2) },
    ]);
  });

  it('ends with one failed event when readings fail MAX_READ_FAILURES times in a row, and reads no more', async () => {
    const failure = new Error('The server did not answer.');
    const { runs, scheduler, events, done } = setup([
      helloRun(0),
      ...Array.from({ length: MAX_READ_FAILURES }, () => failure),
    ]);

    await settle();
    for (let turn = 0; turn < MAX_READ_FAILURES; turn += 1) {
      scheduler.tick();
      await settle();
    }
    await done;

    expect(runs.get).toHaveBeenCalledTimes(1 + MAX_READ_FAILURES);
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'snapshot',
      'failed',
    ]);
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: 'The server did not answer.',
    });
  });

  it('counts only failures in a row: a good reading in between starts the count again', async () => {
    const failure = new Error('Blip.');
    const { runs, scheduler, events, done } = setup([
      failure,
      failure,
      helloRun(0),
      failure,
      failure,
      helloRun(2),
    ]);

    for (let turn = 0; turn < 5; turn += 1) {
      await settle();
      scheduler.tick();
    }
    await done;

    expect(runs.get).toHaveBeenCalledTimes(6);
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'snapshot',
      'snapshot',
    ]);
  });

  it('joins the run that is already active, follows it and says it joined', async () => {
    const { runs, events, done } = setup(
      [helloRun(2)],
      vi
        .fn()
        .mockRejectedValue(
          new RunAlreadyActive('A run is already active.', RUN_ID),
        ),
    );

    await done;

    expect(runs.get).toHaveBeenCalledWith(RUN_ID);
    expect(events).toEqual([
      { type: 'started', runId: RUN_ID, joined: true },
      { type: 'snapshot', run: helloRun(2) },
    ]);
  });

  it('fails when the server answers with a run that is not the one followed', async () => {
    const other: RunView = { ...helloRun(0), runId: 'other' };
    const { runs, scheduler, events, done } = setup([other]);

    await done;

    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(scheduler.waits).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['started', 'failed']);
  });

  it('stops quietly when aborted while it waits to read again', async () => {
    const { runs, scheduler, events, abort, done } = setup([
      new Error('Blip.'),
      helloRun(0),
    ]);
    await settle();

    abort.abort();
    await done;

    expect(scheduler.pendingCount).toBe(0);
    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['started']);
  });

  it('gives a plain message for a failure that is not an Error', async () => {
    const { events, done } = setup([], vi.fn().mockRejectedValue('boom'));

    await done;

    expect(events).toEqual([
      { type: 'failed', message: 'The run did not go as expected.' },
    ]);
  });

  it('emits nothing more once aborted while waiting', async () => {
    const { runs, scheduler, events, abort, done } = setup([
      helloRun(0),
      helloRun(1),
    ]);
    await settle();

    abort.abort();
    await done;

    expect(scheduler.pendingCount).toBe(0);
    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['started', 'snapshot']);
  });

  it('emits nothing when aborted before the run is accepted', async () => {
    let accept: (runId: string) => void = () => {};
    const { runs, events, abort, done } = setup(
      [],
      () => new Promise((resolve) => (accept = resolve)),
    );

    abort.abort();
    accept(RUN_ID);
    await done;

    expect(runs.get).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('emits no reading that arrives after an abort', async () => {
    let arrive: (run: RunView) => void = () => {};
    const events: ExecutionEvent[] = [];
    const abort = new AbortController();
    const done = startAndFollow({
      runs: {
        start: async () => RUN_ID,
        get: () => new Promise((resolve) => (arrive = resolve)),
      },
      scheduler: new FakeScheduler(),
      goal: 'Ship it',
      emit: (event) => events.push(event),
      signal: abort.signal,
    });
    await settle();

    abort.abort();
    arrive(helloRun(0));
    await done;

    expect(events).toEqual([{ type: 'started', runId: RUN_ID }]);
  });

  it('fails when the server answers with a run that is not the one started', async () => {
    const other: RunView = { ...helloRun(0), runId: 'other' };
    const { runs, scheduler, events, done } = setup([other]);

    await done;

    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(scheduler.waits).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['started', 'failed']);
  });

  it('does not report a failure after it was aborted', async () => {
    const { events, abort, done } = setup(
      [],
      vi.fn().mockRejectedValue(new Error('Late.')),
    );
    abort.abort();

    await done;

    expect(events).toEqual([]);
  });
});
