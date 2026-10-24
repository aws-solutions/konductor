// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/** Checks the simulated run against a clock that the test moves. */
import { beforeEach, describe, expect, it } from 'vitest';
import { countingSuffix, FakeClock } from '../test-support/fake-clock.ts';
import { RUN_ID_PATTERN } from './contract.ts';
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
