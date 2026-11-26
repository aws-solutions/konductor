// SPDX-License-Identifier: Apache-2.0
/** Checks the simulated run against a clock that the test moves. */
import { beforeEach, describe, expect, it } from 'vitest';
import { countingSuffix, FakeClock } from '../test-support/fake-clock.ts';
import { MAX_GOAL_CHARS, RUN_ID_PATTERN } from './contract.ts';
import { STAGE_REASONS } from './model.ts';
import { RunSimulator } from './runs.ts';

const GOAL = 'Say hello';
const STAGE_MS = 1000;
let clock: FakeClock;
let runs: RunSimulator;

beforeEach(() => {
  clock = new FakeClock();
  runs = new RunSimulator({
    clock,
    suffix: countingSuffix(),
    stageMs: STAGE_MS,
  });
});

function statusesOf(runId: string): string[] {
  const run = runs.get(runId);
  return Object.values(run?.stages ?? {}).map((stage) => stage.status);
}

describe('a simulated run', () => {
  it('has an id of the contract, made from the start time', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL);
    expect(runId).toBe('20261024-0412-00001');
    expect(runId).toMatch(RUN_ID_PATTERN);
  });

  it('starts with the first stage running and the rest pending', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL);
    expect(runs.get(runId)).toEqual({
      run_id: runId,
      workflow: 'hello',
      harness: 'kiro-cli',
      status: 'running',
      started_at: '2026-10-24T04:12:05Z',
      finished_at: null,
      exit_code: null,
      order: ['draft', 'review'],
      stages: { draft: { status: 'running' }, review: { status: 'pending' } },
    });
  });

  it('runs the stages one after the other and then passes', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL);
    const seen = [statusesOf(runId)];
    for (let step = 0; step < 2; step++) {
      clock.advance(STAGE_MS);
      seen.push(statusesOf(runId));
    }
    expect(seen).toEqual([
      ['running', 'pending'],
      ['passed', 'running'],
      ['passed', 'passed'],
    ]);
    expect(runs.get(runId)).toMatchObject({
      status: 'passed',
      finished_at: '2026-10-24T04:12:07Z',
      exit_code: 0,
    });
  });

  it('stays in a stage until its time is up', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL);
    clock.advance(STAGE_MS - 1);
    expect(statusesOf(runId)).toEqual(['running', 'pending']);
  });

  it('stays readable after it has finished', () => {
    const runId = runs.start('hello', ['draft'], GOAL);
    clock.advance(60 * STAGE_MS);
    expect(runs.get(runId)?.status).toBe('passed');
  });

  it('is the only active run until it finishes', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL);
    expect(runs.activeRunId()).toBe(runId);
    clock.advance(2 * STAGE_MS - 1);
    expect(runs.activeRunId()).toBe(runId);
    clock.advance(1);
    expect(runs.activeRunId()).toBeUndefined();
  });

  it('does not know a run that was never started', () => {
    expect(runs.get('20261024-0412-zzzzz')).toBeUndefined();
  });

  it('gives two runs that start at once two ids', () => {
    const first = runs.start('hello', ['draft'], GOAL);
    const second = runs.start('hello', ['draft'], GOAL);
    expect(second).not.toBe(first);
  });
});

describe('a simulated run that is blocked', () => {
  const STAGES = ['plan', 'build', 'review'];
  const block = { at: 1, reason: 'RESULT_MISSING' } as const;

  it('runs the stages before the blocked one, then halts there', () => {
    const runId = runs.start('hello', STAGES, GOAL, { block });
    const seen = [statusesOf(runId)];
    for (let step = 0; step < 2; step++) {
      clock.advance(STAGE_MS);
      seen.push(statusesOf(runId));
    }
    expect(seen).toEqual([
      ['running', 'pending', 'pending'],
      ['passed', 'running', 'pending'],
      ['passed', 'blocked', 'pending'],
    ]);
  });

  it('halts with exit code 1 when the blocked stage ends', () => {
    const runId = runs.start('hello', STAGES, GOAL, { block });
    clock.advance(2 * STAGE_MS - 1);
    expect(runs.get(runId)).toMatchObject({
      status: 'running',
      finished_at: null,
      exit_code: null,
    });
    expect(runs.activeRunId()).toBe(runId);
    clock.advance(1);
    expect(runs.get(runId)).toMatchObject({
      status: 'halted',
      started_at: '2026-10-24T04:12:05Z',
      finished_at: '2026-10-24T04:12:07Z',
      exit_code: 1,
      stages: {
        plan: { status: 'passed' },
        build: { status: 'blocked', reason: 'RESULT_MISSING' },
        review: { status: 'pending' },
      },
    });
    expect(runs.activeRunId()).toBeUndefined();
  });

  it('gives only the blocked stage a reason, and keeps it as time goes on', () => {
    const runId = runs.start('hello', STAGES, GOAL, { block });
    clock.advance(60 * STAGE_MS);
    const stages = runs.get(runId)?.stages ?? {};
    expect(Object.keys(stages.plan ?? {})).toEqual(['status']);
    expect(Object.keys(stages.review ?? {})).toEqual(['status']);
    expect(stages.build).toEqual({
      status: 'blocked',
      reason: 'RESULT_MISSING',
    });
  });

  it.each(STAGE_REASONS)('can end with the reason %s', (reason) => {
    const runId = runs.start('hello', STAGES, GOAL, {
      block: { at: 0, reason },
    });
    clock.advance(STAGE_MS);
    expect(runs.get(runId)?.stages['plan']).toEqual({
      status: 'blocked',
      reason,
    });
  });

  it('blocks the last stage when the place is past the end', () => {
    const runId = runs.start('hello', ['only'], GOAL, {
      block: { at: 5, reason: 'TIMEOUT' },
    });
    clock.advance(STAGE_MS);
    expect(runs.get(runId)).toMatchObject({
      status: 'halted',
      stages: { only: { status: 'blocked', reason: 'TIMEOUT' } },
    });
  });
});

describe('a simulated run that never ends', () => {
  it('stays in its first stage, and is the active run', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL, {
      neverEnds: true,
    });
    clock.advance(1000 * STAGE_MS);
    expect(runs.get(runId)).toMatchObject({
      status: 'running',
      finished_at: null,
      exit_code: null,
      stages: { draft: { status: 'running' }, review: { status: 'pending' } },
    });
    expect(runs.activeRunId()).toBe(runId);
  });
});

describe('the history of simulated runs', () => {
  it('cuts a goal over the limit between code points, and says so', () => {
    const long = '😀'.repeat(MAX_GOAL_CHARS + 5);
    runs.start('hello', ['only'], long);
    const [row] = runs.list('hello', 10);
    expect(row?.goal).toBe('😀'.repeat(MAX_GOAL_CHARS));
    expect(row?.goal_truncated).toBe(true);
  });

  it('keeps a goal within the limit as it is', () => {
    runs.start('hello', ['only'], GOAL);
    expect(runs.list('hello', 10)).toMatchObject([
      { goal: GOAL, goal_truncated: false },
    ]);
  });
});

describe('the history of one workflow', () => {
  it('leaves out a run of another workflow in the workspace', () => {
    const mine = runs.start('hello', ['only'], GOAL);
    clock.advance(STAGE_MS);
    const other = runs.start('other', ['only'], GOAL);
    expect(runs.list('hello', 10).map((row) => row.run_id)).toEqual([mine]);
    expect(runs.list('other', 10).map((row) => row.run_id)).toEqual([other]);
    expect(runs.get(other)?.workflow).toBe('other');
  });
});

describe('a declared output that a run leaves unwritten', () => {
  const start = (stage: string, output: string) =>
    runs.start('hello', ['draft', 'review'], GOAL, {
      unwritten: { stage, output },
    });

  it('blocks that stage with OUTPUT_MISSING, and halts the run', () => {
    const runId = start('draft', 'design');
    clock.advance(STAGE_MS * 3);
    const run = runs.get(runId);
    expect(run?.status).toBe('halted');
    expect(run?.exit_code).toBe(1);
    expect(run?.stages).toEqual({
      draft: { status: 'blocked', reason: 'OUTPUT_MISSING' },
      review: { status: 'pending' },
    });
  });

  it('passes the stages before it', () => {
    const runId = start('review', 'notes');
    clock.advance(STAGE_MS * 3);
    expect(statusesOf(runId)).toEqual(['passed', 'blocked']);
  });

  it('passes every stage when no output is named', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL);
    clock.advance(STAGE_MS * 3);
    expect(statusesOf(runId)).toEqual(['passed', 'passed']);
  });

  it('leaves the run alone when the stage named is not in it', () => {
    const runId = start('gone', 'design');
    clock.advance(STAGE_MS * 3);
    expect(statusesOf(runId)).toEqual(['passed', 'passed']);
  });

  it('keeps a block the caller asked for over an unwritten output', () => {
    const runId = runs.start('hello', ['draft', 'review'], GOAL, {
      block: { at: 0, reason: 'RESULT_MISSING' },
      unwritten: { stage: 'review', output: 'notes' },
    });
    clock.advance(STAGE_MS * 3);
    expect(runs.get(runId)?.stages['draft']).toEqual({
      status: 'blocked',
      reason: 'RESULT_MISSING',
    });
  });
});
