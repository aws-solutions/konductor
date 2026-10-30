// SPDX-License-Identifier: Apache-2.0
/** Checks the simulated run against a clock that the test moves. */
import { beforeEach, describe, expect, it } from 'vitest';
import { countingSuffix, FakeClock } from '../test-support/fake-clock.ts';
import { RUN_ID_PATTERN } from './contract.ts';
import { STAGE_REASONS } from './model.ts';
import { RunSimulator } from './runs.ts';

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
    const runId = runs.start('hello', ['draft', 'review']);
    expect(runId).toBe('20261024-0412-00001');
    expect(runId).toMatch(RUN_ID_PATTERN);
  });

  it('starts with the first stage running and the rest pending', () => {
    const runId = runs.start('hello', ['draft', 'review']);
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
    const runId = runs.start('hello', ['draft', 'review']);
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
    const runId = runs.start('hello', ['draft', 'review']);
    clock.advance(STAGE_MS - 1);
    expect(statusesOf(runId)).toEqual(['running', 'pending']);
  });

  it('stays readable after it has finished', () => {
    const runId = runs.start('hello', ['draft']);
    clock.advance(60 * STAGE_MS);
    expect(runs.get(runId)?.status).toBe('passed');
  });

  it('is the only active run until it finishes', () => {
    const runId = runs.start('hello', ['draft', 'review']);
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
    const first = runs.start('hello', ['draft']);
    const second = runs.start('hello', ['draft']);
    expect(second).not.toBe(first);
  });
});

describe('a simulated run that is blocked', () => {
  const STAGES = ['plan', 'build', 'review'];
  const block = { at: 1, reason: 'RESULT_MISSING' } as const;

  it('runs the stages before the blocked one, then halts there', () => {
    const runId = runs.start('hello', STAGES, { block });
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
    const runId = runs.start('hello', STAGES, { block });
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
    const runId = runs.start('hello', STAGES, { block });
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
    const runId = runs.start('hello', STAGES, { block: { at: 0, reason } });
    clock.advance(STAGE_MS);
    expect(runs.get(runId)?.stages['plan']).toEqual({
      status: 'blocked',
      reason,
    });
  });

  it('blocks the last stage when the place is past the end', () => {
    const runId = runs.start('hello', ['only'], {
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
    const runId = runs.start('hello', ['draft', 'review'], { neverEnds: true });
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
