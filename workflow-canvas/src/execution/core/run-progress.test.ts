// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { applyRunEvents, startFollowing, type RunEvent } from './run-follow';
import {
  formatElapsed,
  progressText,
  runProgress,
  type RunProgress,
} from './run-progress';

const START = 1_000_000;
const clockAt = (ms: number) => () => START + ms;

function runOf(events: readonly RunEvent[]) {
  return applyRunEvents(startFollowing(['draft', 'review', 'ship']), events);
}

const DRAFT_PASSED: RunEvent[] = [
  { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
  { seq: 2, type: 'stage_state', stage: 'draft', status: 'passed' },
];

describe('runProgress', () => {
  it('counts the passed stages and names the one at work', () => {
    const run = runOf([
      ...DRAFT_PASSED,
      { seq: 3, type: 'stage_state', stage: 'review', status: 'running' },
    ]);

    expect(runProgress(run, { startedAt: START }, clockAt(42_000))).toEqual({
      passed: 1,
      total: 3,
      running: 'review',
      elapsedMs: 42_000,
    });
  });

  it('names the blocked stage and its reason, and the outcome', () => {
    const run = runOf([
      ...DRAFT_PASSED,
      {
        seq: 3,
        type: 'stage_state',
        stage: 'review',
        status: 'blocked',
        reason: 'CHECK_FAILED',
      },
      {
        seq: 4,
        type: 'run_finished',
        at: '1970-01-01T00:16:49Z',
        status: 'halted',
        exit_code: 1,
      },
    ]);

    expect(
      runProgress(
        run,
        { startedAt: START, finishedAt: START + 9_000 },
        clockAt(60_000),
      ),
    ).toEqual({
      passed: 1,
      total: 3,
      blocked: { name: 'review', reason: 'CHECK_FAILED' },
      outcome: 'halted',
      elapsedMs: 9_000,
    });
  });

  it('stops the elapsed time at the end of the run', () => {
    const progress = runProgress(
      runOf(DRAFT_PASSED),
      { startedAt: START, finishedAt: START + 5_000 },
      clockAt(99_000),
    );

    expect(progress.elapsedMs).toBe(5_000);
  });

  it('stops the elapsed time at the at of run_finished when the timing has no end', () => {
    const finished = runOf([
      ...DRAFT_PASSED,
      {
        seq: 3,
        type: 'run_finished',
        at: '1970-01-01T00:16:47Z',
        status: 'passed',
        exit_code: 0,
      },
    ]);

    // START is 00:16:40, so the run took 7 seconds.
    const progress = runProgress(
      finished,
      { startedAt: START },
      clockAt(500_000),
    );
    expect(progress.outcome).toBe('passed');
    expect(progress.elapsedMs).toBe(7_000);
  });

  it('reads the clock while the run goes on', () => {
    let now = START + 1_000;
    const clock = () => now;
    const run = runOf(DRAFT_PASSED);

    expect(runProgress(run, { startedAt: START }, clock).elapsedMs).toBe(1_000);
    now = START + 3_500;
    expect(runProgress(run, { startedAt: START }, clock).elapsedMs).toBe(3_500);
  });

  it('never gives a negative elapsed time for a clock behind the start', () => {
    const progress = runProgress(
      runOf([]),
      { startedAt: START },
      clockAt(-2_000),
    );

    expect(progress.elapsedMs).toBe(0);
  });
});

describe('runProgress with the run over and no last event', () => {
  it('shows no stage at work', () => {
    const run = runOf([
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
    ]);

    const progress = runProgress(run, { startedAt: START }, clockAt(3_000), {
      ended: true,
    });

    expect(progress.running).toBeUndefined();
    expect(progress.ended).toBe(true);
  });

  it('keeps the blocked stage it did read', () => {
    const run = runOf([
      {
        seq: 1,
        type: 'stage_state',
        stage: 'draft',
        status: 'blocked',
        reason: 'RESULT_MISSING',
      },
    ]);

    const progress = runProgress(run, { startedAt: START }, clockAt(3_000), {
      ended: true,
    });

    expect(progress.blocked?.name).toBe('draft');
  });

  it('leaves the stage at work alone when the run said how it ended', () => {
    const run = runOf([
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'passed' },
      { seq: 2, type: 'stage_state', stage: 'review', status: 'running' },
    ]);

    const progress = runProgress(run, { startedAt: START }, clockAt(3_000));

    expect(progress.running).toBe('review');
    expect(progress).not.toHaveProperty('ended');
  });
});

describe('progressText', () => {
  const base: RunProgress = { passed: 1, total: 3, elapsedMs: 0 };

  it.each<[string, RunProgress, string]>([
    [
      'a stage at work',
      { ...base, running: 'review' },
      'Running review. 1 of 3 stages passed.',
    ],
    [
      'no stage at work',
      base,
      'Waiting for the next stage. 1 of 3 stages passed.',
    ],
    [
      'a blocked stage before the end event',
      { ...base, blocked: { name: 'review' } },
      'Blocked at review. 1 of 3 stages passed.',
    ],
    [
      'a run that is over with no last event',
      { ...base, ended: true as const },
      'The run ended. 1 of 3 stages passed.',
    ],
    [
      'a halted run',
      { ...base, blocked: { name: 'review' }, outcome: 'halted' },
      'Run halted at review. 1 of 3 stages passed.',
    ],
    [
      'a passed run',
      { ...base, passed: 3, outcome: 'passed' },
      'Run passed. 3 of 3 stages passed.',
    ],
  ])('says where the run is with %s', (_, progress, text) => {
    expect(progressText(progress)).toBe(text);
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [42_000, '0:42'],
    [65_000, '1:05'],
    [3_599_000, '59:59'],
    [3_723_000, '1:02:03'],
    [-5_000, '0:00'],
  ])('writes %i ms as %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
