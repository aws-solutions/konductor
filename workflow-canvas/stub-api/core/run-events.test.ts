// SPDX-License-Identifier: Apache-2.0
/** Checks the events of a simulated run against its state, on a clock the test moves. */
import { beforeEach, describe, expect, it } from 'vitest';
import { schemaOf } from '../test-support/contract.ts';
import { countingSuffix, FakeClock } from '../test-support/fake-clock.ts';
import type { Run, RunEvent } from './model.ts';
import { RunSimulator, type RunPlan } from './runs.ts';

const GOAL = 'Say hello';
const STAGE_MS = 3000;
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

// The state that the state events give when applied in order.
function stateOf(order: readonly string[], events: RunEvent[]) {
  const stages: Run['stages'] = Object.fromEntries(
    order.map((name) => [name, { status: 'pending' }]),
  );
  let status: Run['status'] = 'running';
  let exitCode: number | null = null;
  for (const event of events) {
    if (event.type === 'stage_state') {
      const { status: state, reason } = event;
      stages[event.stage] = reason
        ? { status: state, reason }
        : { status: state };
    } else if (event.type === 'run_finished') {
      status = event.status;
      exitCode = event.exit_code;
    }
  }
  return { status, exit_code: exitCode, stages };
}

const ORDER = ['draft', 'review', 'wrap-up'];

describe('the events of a simulated run', () => {
  it.each<[string, RunPlan]>([
    ['passes', {}],
    ['halts', { block: { at: 1, reason: 'RESULT_MISSING' } }],
  ])(
    'agree with the state of a run that %s, at every step of the clock',
    (_, plan) => {
      const runId = runs.start('hello', ORDER, GOAL, plan);
      for (let step = 0; step <= ORDER.length * 3 + 1; step++) {
        const run = runs.get(runId)!;
        const { events } = runs.events(runId)!;
        expect(stateOf(ORDER, events), `at step ${step}`).toEqual({
          status: run.status,
          exit_code: run.exit_code,
          stages: run.stages,
        });
        clock.advance(STAGE_MS / 3);
      }
    },
  );

  it('number every event from 1 while the run is active, console lines included', () => {
    const runId = runs.start('hello', ORDER, GOAL);
    clock.advance(STAGE_MS * ORDER.length - 1);
    const { events, lastSeq, finished } = runs.events(runId)!;
    expect(finished).toBe(false);
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: lastSeq }, (_, i) => i + 1),
    );
    expect(events.filter((e) => e.type === 'console')).toHaveLength(6);
  });

  it('print each line of a stage while it runs, numbered from 1', () => {
    const runId = runs.start('hello', ORDER, GOAL);
    clock.advance(STAGE_MS / 3);
    expect(runs.events(runId)!.events.at(-1)).toEqual({
      seq: 2,
      run_id: runId,
      at: '2026-10-24T04:12:06Z',
      type: 'console',
      stage: 'draft',
      n: 1,
      text: 'Working on the draft stage.',
    });
  });

  it('drop the console lines once the run has finished, and keep the rest', () => {
    const runId = runs.start('hello', ORDER, GOAL, {
      block: { at: 0, reason: 'TIMEOUT' },
    });
    clock.advance(STAGE_MS);
    const { events, lastSeq, finished } = runs.events(runId)!;
    expect(finished).toBe(true);
    expect(lastSeq).toBe(5);
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [1, 'stage_state'],
      [4, 'stage_state'],
      [5, 'run_finished'],
    ]);
  });

  it('say when the next event is due, and nothing once the run has finished', () => {
    const runId = runs.start('hello', ['only'], GOAL);
    expect(runs.events(runId)!.nextAt).toBe(clock.now() + STAGE_MS / 3);
    clock.advance(STAGE_MS);
    expect(runs.events(runId)!.nextAt).toBeUndefined();
  });

  it('stay in the first stage of a run that never ends', () => {
    const runId = runs.start('hello', ORDER, GOAL, { neverEnds: true });
    clock.advance(STAGE_MS * 10);
    const { events, finished, nextAt } = runs.events(runId)!;
    expect(finished).toBe(false);
    expect(nextAt).toBeUndefined();
    expect(stateOf(ORDER, events).stages['draft']).toEqual({
      status: 'running',
    });
  });

  it('are only of the types the contract names for this version', () => {
    const known = new Set(
      (
        schemaOf('RunEvent').oneOf as {
          properties: { type: { const?: string } };
        }[]
      )
        .map((branch) => branch.properties.type.const)
        .filter((type): type is string => type !== undefined),
    );
    expect([...known].sort()).toEqual([
      'console',
      'run_finished',
      'stage_state',
    ]);
    for (const plan of [{}, { block: { at: 1, reason: 'TIMEOUT' as const } }]) {
      const runId = runs.start('hello', ORDER, plan);
      for (let step = 0; step <= ORDER.length * 3; step++) {
        for (const event of runs.events(runId)!.events) {
          expect(known.has(event.type), event.type).toBe(true);
        }
        clock.advance(STAGE_MS / 3);
      }
    }
  });

  it('are not there for a run that does not exist', () => {
    expect(runs.events('20261024-0412-99999')).toBeUndefined();
  });
});
