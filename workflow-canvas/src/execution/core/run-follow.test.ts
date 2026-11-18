// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  applyRunEvents,
  CONSOLE_LINES_PER_STAGE,
  startFollowing,
  type FollowedRun,
  type RunEvent,
} from './run-follow';

const ORDER = ['draft', 'review'];

// The events of a run of `ORDER` that passes, with a console line each.
const PASSING: readonly RunEvent[] = [
  { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
  { seq: 2, type: 'console', stage: 'draft', n: 1, text: 'Writing PLAN.md' },
  { seq: 3, type: 'stage_state', stage: 'draft', status: 'passed' },
  { seq: 4, type: 'stage_state', stage: 'review', status: 'running' },
  { seq: 5, type: 'console', stage: 'review', n: 1, text: 'Reading PLAN.md' },
  { seq: 6, type: 'stage_state', stage: 'review', status: 'passed' },
  { seq: 7, type: 'run_finished', status: 'passed', exit_code: 0 },
];

function follow(events: readonly RunEvent[]): FollowedRun {
  return applyRunEvents(startFollowing(ORDER), events);
}

function stage(run: FollowedRun, name: string) {
  return run.stages.find((each) => each.name === name);
}

function lines(stage: string, from: number, count: number): RunEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: from + index,
    type: 'console',
    stage,
    n: from + index,
    text: `line ${from + index}`,
  }));
}

describe('startFollowing', () => {
  it('has every stage pending, no outcome, and asks from the start', () => {
    expect(startFollowing(ORDER)).toEqual({
      stages: [
        { name: 'draft', status: 'pending', console: [] },
        { name: 'review', status: 'pending', console: [] },
      ],
      next: 0,
    });
  });
});

describe('applyRunEvents', () => {
  it('gives each stage its status and lines, the outcome and the next after', () => {
    const run = follow(PASSING);

    expect(run).toEqual({
      stages: [
        {
          name: 'draft',
          status: 'passed',
          console: [{ n: 1, text: 'Writing PLAN.md' }],
        },
        {
          name: 'review',
          status: 'passed',
          console: [{ n: 1, text: 'Reading PLAN.md' }],
        },
      ],
      outcome: { status: 'passed', exitCode: 0 },
      next: 7,
    });
  });

  it('keeps the reason of a blocked stage and the exit code of a halt', () => {
    const run = follow([
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
      {
        seq: 2,
        type: 'stage_state',
        stage: 'draft',
        status: 'blocked',
        reason: 'OUTPUT_MISSING',
      },
      { seq: 3, type: 'run_finished', status: 'halted', exit_code: 1 },
    ]);

    expect(stage(run, 'draft')).toMatchObject({
      status: 'blocked',
      reason: 'OUTPUT_MISSING',
    });
    expect(stage(run, 'review')?.status).toBe('pending');
    expect(run.outcome).toEqual({ status: 'halted', exitCode: 1 });
  });

  it('has no outcome while the run goes on', () => {
    const run = follow(PASSING.slice(0, 4));

    expect(run.outcome).toBeUndefined();
    expect(stage(run, 'review')?.status).toBe('running');
    expect(run.next).toBe(4);
  });

  it('changes nothing twice when a resume replays events it has read', () => {
    const first = follow(PASSING.slice(0, 5));
    // A resume from an earlier `after`, such as after a reload of the page.
    const resumed = applyRunEvents(first, PASSING.slice(2));

    expect(resumed).toEqual(follow(PASSING));
  });

  it('takes a gap in seq for skipped events, not for lost ones', () => {
    // A finished run keeps no console lines, so seq 2 and 5 are not sent.
    const run = follow(PASSING.filter((event) => event.type !== 'console'));

    expect(run.outcome).toEqual({ status: 'passed', exitCode: 0 });
    expect(run.next).toBe(7);
    expect(stage(run, 'draft')).toEqual({
      name: 'draft',
      status: 'passed',
      console: [],
    });
  });

  it('drops a second event with a seq it already has', () => {
    const run = follow([
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'passed' },
      { seq: 2, type: 'console', stage: 'draft', n: 1, text: 'once' },
      { seq: 2, type: 'console', stage: 'draft', n: 1, text: 'once' },
    ]);

    expect(stage(run, 'draft')).toEqual({
      name: 'draft',
      status: 'running',
      console: [{ n: 1, text: 'once' }],
    });
    expect(run.next).toBe(2);
  });

  it('skips an event of an unknown type but moves past it', () => {
    const run = follow([
      PASSING[0]!,
      { seq: 2, type: 'stage_retry', stage: 'draft', round: 2 } as RunEvent,
      { seq: 3, type: 'stage_state', stage: 'draft', status: 'passed' },
    ]);

    expect(stage(run, 'draft')?.status).toBe('passed');
    expect(run.next).toBe(3);
  });

  it('ignores an event for a stage the run does not have', () => {
    const run = follow([
      { seq: 1, type: 'stage_state', stage: 'other', status: 'running' },
      { seq: 2, type: 'console', stage: 'other', n: 1, text: 'stray' },
    ]);

    expect(run.stages).toEqual(startFollowing(ORDER).stages);
    expect(run.next).toBe(2);
  });

  it('changes nothing after the run has finished', () => {
    const run = follow([
      ...PASSING,
      { seq: 8, type: 'stage_state', stage: 'draft', status: 'blocked' },
    ]);

    expect(stage(run, 'draft')?.status).toBe('passed');
    expect(run.next).toBe(8);
  });

  it(`keeps the last ${CONSOLE_LINES_PER_STAGE} lines of a stage and drops the oldest`, () => {
    const over = CONSOLE_LINES_PER_STAGE + 5;
    const run = follow([
      ...lines('draft', 1, over),
      {
        seq: over + 1,
        type: 'console',
        stage: 'review',
        n: 1,
        text: 'other stage',
      },
    ]);
    const kept = stage(run, 'draft')?.console ?? [];

    expect(kept).toHaveLength(CONSOLE_LINES_PER_STAGE);
    expect(kept[0]).toEqual({ n: 6, text: 'line 6' });
    expect(kept.at(-1)).toEqual({ n: over, text: `line ${over}` });
    expect(stage(run, 'review')?.console).toEqual([
      { n: 1, text: 'other stage' },
    ]);
  });

  it('keeps the text of a line as sent', () => {
    const text = '<b>bold</b> &amp; "quoted"';
    const run = follow([
      { seq: 1, type: 'console', stage: 'draft', n: 1, text },
    ]);

    expect(stage(run, 'draft')?.console).toEqual([{ n: 1, text }]);
  });

  it('leaves the state it is given unchanged', () => {
    const before = startFollowing(ORDER);
    const copy = structuredClone(before);

    applyRunEvents(before, PASSING);

    expect(before).toEqual(copy);
  });
});
