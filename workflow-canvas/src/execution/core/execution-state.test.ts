// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { helloRun } from '../../test-support/fixtures';
import {
  IDLE,
  isInFlight,
  reduce,
  runOf,
  type ExecutionEvent,
  type ExecutionState,
} from './execution-state';

const RUN_ID = helloRun(0).runId;

function after(...events: ExecutionEvent[]): ExecutionState {
  return events.reduce(reduce, IDLE);
}

const STARTED: ExecutionEvent[] = [
  { type: 'start' },
  { type: 'started', runId: RUN_ID },
];

describe('reduce', () => {
  it('starts idle', () => {
    expect(IDLE).toEqual({ phase: 'idle' });
    expect(isInFlight(IDLE)).toBe(false);
  });

  it('is starting once a run is asked for, then following once it has an id', () => {
    expect(after({ type: 'start' })).toEqual({ phase: 'starting' });
    expect(after(...STARTED)).toEqual({
      phase: 'following',
      runId: RUN_ID,
      run: undefined,
    });
  });

  it('keeps the latest reading while the run is running', () => {
    const state = after(
      ...STARTED,
      { type: 'snapshot', run: helloRun(0) },
      { type: 'snapshot', run: helloRun(1) },
    );

    expect(state).toEqual({
      phase: 'following',
      runId: RUN_ID,
      run: helloRun(1),
    });
    expect(runOf(state)).toEqual(helloRun(1));
    expect(isInFlight(state)).toBe(true);
  });

  it.each([
    ['passed', helloRun(2)],
    ['halted', helloRun(0, { blockedAt: 0 })],
  ])('finishes with a run that %s', (_, run) => {
    const state = after(...STARTED, { type: 'snapshot', run });

    expect(state).toEqual({ phase: 'finished', run });
    expect(isInFlight(state)).toBe(false);
    expect(runOf(state)).toBe(run);
  });

  it('ignores a start while a run is in flight', () => {
    const starting = after({ type: 'start' });
    const following = after(...STARTED);

    expect(reduce(starting, { type: 'start' })).toBe(starting);
    expect(reduce(following, { type: 'start' })).toBe(following);
  });

  it('can start again after a run finished or failed', () => {
    const finished = after(...STARTED, {
      type: 'snapshot',
      run: helloRun(2),
    });
    const failed = after({ type: 'start' }, { type: 'failed', message: 'x' });

    expect(reduce(finished, { type: 'start' })).toEqual({ phase: 'starting' });
    expect(reduce(failed, { type: 'start' })).toEqual({ phase: 'starting' });
  });

  it('keeps that a start got no clear answer', () => {
    expect(
      after(
        { type: 'start' },
        { type: 'failed', message: 'No.', maybeStarted: true },
      ),
    ).toEqual({
      phase: 'error',
      message: 'No.',
      started: false,
      maybeStarted: true,
    });
  });

  it('takes a failure that names no run for the start in progress', () => {
    // Why the caller runs one loop at a time: a second loop's failure with no
    // run id cannot be told from the failure of the start.
    expect(
      after({ type: 'start' }, { type: 'failed', message: 'Other loop.' }),
    ).toMatchObject({ phase: 'error', started: false });
  });

  it('fails before the run started, or after, and says which', () => {
    expect(
      after({ type: 'start' }, { type: 'failed', message: 'No.' }),
    ).toEqual({
      phase: 'error',
      message: 'No.',
      started: false,
    });
    expect(
      after(...STARTED, { type: 'failed', message: 'Lost.', runId: RUN_ID }),
    ).toEqual({
      phase: 'error',
      message: 'Lost.',
      started: true,
      runId: RUN_ID,
    });
  });

  it('ignores a failure of a loop that has no run once the tab follows one', () => {
    // Two loops were started; one was refused, and it never had a run.
    const following = after(...STARTED);

    expect(
      reduce(following, {
        type: 'failed',
        message: 'A run is already active.',
      }),
    ).toBe(following);
  });

  it('ignores a failure that names another run', () => {
    const following = after(...STARTED);

    expect(
      reduce(following, {
        type: 'failed',
        message: 'Lost.',
        runId: '20261024-0412-zzzzz',
      }),
    ).toBe(following);
  });

  it('ignores a failure that names a run while the start has no run yet', () => {
    const starting = after({ type: 'start' });

    expect(
      reduce(starting, { type: 'failed', message: 'x', runId: RUN_ID }),
    ).toBe(starting);
  });

  it('follows a run that was already active, and keeps saying so', () => {
    const joined = after(
      { type: 'start' },
      { type: 'started', runId: RUN_ID, joined: true },
    );

    expect(joined).toEqual({
      phase: 'following',
      runId: RUN_ID,
      run: undefined,
      joined: true,
    });
    expect(reduce(joined, { type: 'snapshot', run: helloRun(0) })).toEqual({
      phase: 'following',
      runId: RUN_ID,
      run: helloRun(0),
      joined: true,
    });
    expect(reduce(joined, { type: 'snapshot', run: helloRun(2) })).toEqual({
      phase: 'finished',
      run: helloRun(2),
    });
  });

  it('shows no run in an error', () => {
    const state = after(
      ...STARTED,
      { type: 'snapshot', run: helloRun(0) },
      { type: 'failed', message: 'Lost.', runId: RUN_ID },
    );

    expect(runOf(state)).toBeUndefined();
  });

  it('ignores a reading of another run', () => {
    const following = after(...STARTED);
    const other = { ...helloRun(1), runId: '20261024-0412-zzzzz' };

    expect(reduce(following, { type: 'snapshot', run: other })).toBe(following);
  });

  it.each<[string, ExecutionState, ExecutionEvent]>([
    ['a reading when idle', IDLE, { type: 'snapshot', run: helloRun(0) }],
    ['an id when idle', IDLE, { type: 'started', runId: RUN_ID }],
    [
      'a failure when idle',
      IDLE,
      { type: 'failed', message: 'x', runId: RUN_ID },
    ],
    [
      'an id when following',
      after(...STARTED),
      { type: 'started', runId: 'other' },
    ],
  ])('ignores %s', (_, state, event) => {
    expect(reduce(state, event)).toBe(state);
  });

  it('does not move on a failure after the run finished', () => {
    const finished = after(...STARTED, {
      type: 'snapshot',
      run: helloRun(2),
    });

    expect(
      reduce(finished, { type: 'failed', message: 'x', runId: RUN_ID }),
    ).toBe(finished);
  });
});
