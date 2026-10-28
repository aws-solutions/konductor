// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import type { RunView } from '../../api/types';
import { FakeScheduler } from '../../test-support/fake-scheduler';
import { helloRun } from '../../test-support/fixtures';
import type { ExecutionEvent } from './execution-state';
import { IDLE, reduce } from './execution-state';
import {
  MAX_READ_FAILURES,
  POLL_INTERVAL_MS,
  startAndFollow,
} from './follow-run';
import { RunAlreadyActive, RunReadRefused, type RunPort } from './ports';

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

    expect(runs.start).toHaveBeenCalledWith('Ship it', expect.any(AbortSignal));
    expect(runs.get).toHaveBeenCalledWith(RUN_ID, expect.any(AbortSignal));
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
      { type: 'failed', message: 'A run is already active.', runId: undefined },
    ]);
  });

  describe('when a reading fails', () => {
    const blip = () => new Error('The server did not answer.');

    it('reads again after a poll interval and goes on when the next one works', async () => {
      const { runs, scheduler, events, done } = setup([
        helloRun(0),
        blip(),
        helloRun(2),
      ]);

      await settle();
      scheduler.tick();
      await settle();
      expect(runs.get).toHaveBeenCalledTimes(2);
      scheduler.tick();
      await done;

      expect(runs.get).toHaveBeenCalledTimes(3);
      expect(events.map((event) => event.type)).toEqual([
        'started',
        'snapshot',
        'snapshot',
      ]);
    });

    it('gives up after MAX_READ_FAILURES in a row, and says which run it was', async () => {
      const { runs, scheduler, events, done } = setup([
        helloRun(0),
        ...Array.from({ length: MAX_READ_FAILURES }, blip),
      ]);

      for (let turn = 0; turn < MAX_READ_FAILURES + 1; turn += 1) {
        await settle();
        scheduler.tick();
      }
      await done;

      expect(runs.get).toHaveBeenCalledTimes(1 + MAX_READ_FAILURES);
      expect(events.at(-1)).toEqual({
        type: 'failed',
        message: 'The server did not answer.',
        runId: RUN_ID,
      });
      expect(events.filter((e) => e.type === 'failed')).toHaveLength(1);
    });

    it('counts the failures in a row, so a good reading in between starts the count again', async () => {
      const readings = [
        helloRun(0),
        blip(),
        blip(),
        helloRun(1),
        blip(),
        blip(),
        helloRun(2),
      ];
      const { runs, scheduler, events, done } = setup(readings);

      for (let turn = 0; turn < readings.length; turn += 1) {
        await settle();
        scheduler.tick();
      }
      await done;

      expect(runs.get).toHaveBeenCalledTimes(readings.length);
      expect(events.map((event) => event.type)).toEqual([
        'started',
        'snapshot',
        'snapshot',
        'snapshot',
      ]);
    });

    it('does not try again when the server refuses the read', async () => {
      const refused = new RunReadRefused('There is no run with this id.');
      const { runs, scheduler, events, done } = setup([refused]);

      await done;

      expect(runs.get).toHaveBeenCalledTimes(1);
      expect(scheduler.waits).toEqual([]);
      expect(events).toEqual([
        { type: 'started', runId: RUN_ID },
        { type: 'failed', message: refused.message, runId: RUN_ID },
      ]);
    });

    it('stops quietly when aborted while it waits to try again', async () => {
      const { runs, events, abort, done } = setup([blip(), helloRun(0)]);
      await settle();

      abort.abort();
      await done;

      expect(runs.get).toHaveBeenCalledTimes(1);
      expect(events).toEqual([{ type: 'started', runId: RUN_ID }]);
    });
  });

  describe('when a run is already active', () => {
    const active = () =>
      vi.fn().mockRejectedValue(new RunAlreadyActive('Busy.', RUN_ID));

    it('follows that run and says it joined it', async () => {
      const { runs, events, done } = setup([helloRun(2)], active());

      await done;

      expect(runs.get).toHaveBeenCalledWith(RUN_ID, expect.any(AbortSignal));
      expect(events).toEqual([
        { type: 'started', runId: RUN_ID, joined: true },
        { type: 'snapshot', run: helloRun(2) },
      ]);
    });

    it('does not start another run', async () => {
      const start = active();
      const { done } = setup([helloRun(2)], start);

      await done;

      expect(start).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the server never answers a read', () => {
    // A port honours its signal: aborting rejects the call that is pending.
    function hangingRuns(): RunPort {
      const hang = (signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      return {
        start: vi.fn().mockResolvedValue(RUN_ID),
        get: vi.fn((_id: string, signal: AbortSignal) => hang(signal)),
      };
    }

    it('ends without a word when it is aborted', async () => {
      const events: ExecutionEvent[] = [];
      const abort = new AbortController();
      const done = startAndFollow({
        runs: hangingRuns(),
        scheduler: new FakeScheduler(),
        goal: 'Ship it',
        emit: (event) => events.push(event),
        signal: abort.signal,
      });
      await settle();

      abort.abort();
      await done;

      expect(events).toEqual([{ type: 'started', runId: RUN_ID }]);
    });

    it('ends without a word when the start hangs and it is aborted', async () => {
      const events: ExecutionEvent[] = [];
      const abort = new AbortController();
      const runs: RunPort = {
        start: (_goal, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('x'))),
          ),
        get: vi.fn(),
      };
      const done = startAndFollow({
        runs,
        scheduler: new FakeScheduler(),
        goal: 'Ship it',
        emit: (event) => events.push(event),
        signal: abort.signal,
      });
      await settle();

      abort.abort();
      await done;

      expect(events).toEqual([]);
    });
  });

  describe('when two loops are started for one click', () => {
    it('keeps the state of the loop that won when the other is refused', async () => {
      let state = reduce(IDLE, { type: 'start' });
      const emit = (event: ExecutionEvent) => {
        state = reduce(state, event);
      };
      const scheduler = new FakeScheduler();
      const stop = new AbortController();
      const winner = startAndFollow({
        runs: {
          start: async () => RUN_ID,
          get: async () => helloRun(0),
        },
        scheduler,
        goal: 'Ship it',
        emit,
        signal: stop.signal,
      });
      await settle();
      const loser = startAndFollow({
        runs: {
          start: () => Promise.reject(new Error('A run is already active.')),
          get: vi.fn(),
        },
        scheduler: new FakeScheduler(),
        goal: 'Ship it',
        emit,
        signal: new AbortController().signal,
      });
      await loser;

      expect(state).toMatchObject({ phase: 'following', runId: RUN_ID });

      scheduler.tick();
      await settle();
      expect(state).toMatchObject({ phase: 'following', run: helloRun(0) });

      stop.abort();
      await winner;
    });
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
