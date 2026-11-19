// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  applyRunEvents,
  CONSOLE_LINES_PER_RUN,
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
  {
    seq: 7,
    type: 'run_finished',
    at: '2026-10-24T04:12:23Z',
    status: 'passed',
    exit_code: 0,
  },
];

function follow(events: readonly RunEvent[]): FollowedRun {
  return applyRunEvents(startFollowing(ORDER), events);
}

function stage(run: FollowedRun, name: string) {
  return run.stages.find((each) => each.name === name);
}

// `count` console lines of `stage`, numbered from 1, from `seq` on.
function lines(stage: string, seq: number, count: number): RunEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: seq + index,
    type: 'console',
    stage,
    n: index + 1,
    text: `line ${index + 1}`,
  }));
}

describe('startFollowing', () => {
  it('has every stage pending, no outcome, and asks from the start', () => {
    expect(startFollowing(ORDER)).toEqual({
      stages: [
        { name: 'draft', status: 'pending', console: [], dropped: false },
        { name: 'review', status: 'pending', console: [], dropped: false },
      ],
      next: 0,
      consoleOrder: [],
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
          dropped: false,
        },
        {
          name: 'review',
          status: 'passed',
          console: [{ n: 1, text: 'Reading PLAN.md' }],
          dropped: false,
        },
      ],
      outcome: { status: 'passed', exitCode: 0 },
      finishedAt: Date.parse('2026-10-24T04:12:23Z'),
      next: 7,
      consoleOrder: ['draft', 'review'],
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
      {
        seq: 3,
        type: 'run_finished',
        at: '2026-10-24T04:12:49Z',
        status: 'halted',
        exit_code: 1,
      },
    ]);

    expect(run.finishedAt).toBe(Date.parse('2026-10-24T04:12:49Z'));
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
    // A run read a minute after it finished has no console lines, so seq 2
    // and 5 are not sent.
    const run = follow(PASSING.filter((event) => event.type !== 'console'));

    expect(run.outcome).toEqual({ status: 'passed', exitCode: 0 });
    expect(run.next).toBe(7);
    expect(stage(run, 'draft')).toEqual({
      name: 'draft',
      status: 'passed',
      console: [],
      dropped: false,
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
      dropped: false,
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

  it(`keeps the last ${CONSOLE_LINES_PER_RUN} lines of the run and drops the oldest`, () => {
    const over = CONSOLE_LINES_PER_RUN + 5;
    const run = follow(lines('draft', 1, over));
    const kept = stage(run, 'draft')?.console ?? [];

    expect(kept).toHaveLength(CONSOLE_LINES_PER_RUN);
    expect(kept[0]).toEqual({ n: 6, text: 'line 6' });
    expect(kept.at(-1)).toEqual({ n: over, text: `line ${over}` });
    expect(stage(run, 'draft')?.dropped).toBe(true);
  });

  it('caps the lines of all stages together, dropping the oldest whatever its stage', () => {
    const run = applyRunEvents(startFollowing(['plan', 'build', 'check']), [
      ...lines('plan', 1, 400),
      ...lines('build', 401, 500),
      ...lines('check', 901, 300),
    ]);
    const held = run.stages.flatMap((each) => each.console);
    const [plan, build, check] = run.stages;

    expect(held.length).toBeLessThanOrEqual(CONSOLE_LINES_PER_RUN);
    expect(held).toHaveLength(CONSOLE_LINES_PER_RUN);
    expect(plan?.console[0]).toEqual({ n: 201, text: 'line 201' });
    expect(plan?.console).toHaveLength(200);
    expect(build?.console).toHaveLength(500);
    expect(check?.console).toHaveLength(300);
    expect(run.stages.map((each) => each.dropped)).toEqual([
      true,
      false,
      false,
    ]);
    expect(run.consoleOrder).toHaveLength(CONSOLE_LINES_PER_RUN);
  });

  it('empties a stage whose lines are all the oldest, and says they were dropped', () => {
    const run = follow([
      ...lines('draft', 1, 3),
      ...lines('review', 4, CONSOLE_LINES_PER_RUN),
    ]);

    expect(stage(run, 'draft')).toMatchObject({ console: [], dropped: true });
    expect(stage(run, 'review')?.console).toHaveLength(CONSOLE_LINES_PER_RUN);
    expect(stage(run, 'review')?.dropped).toBe(false);
  });

  it('says lines were dropped when the first line held is not line 1', () => {
    // A tab that joins late gets only the lines the server still holds.
    const run = follow([
      { seq: 9, type: 'console', stage: 'draft', n: 4, text: 'later' },
    ]);

    expect(stage(run, 'draft')?.dropped).toBe(true);
  });

  it('keeps the dropped mark when the stage moves on', () => {
    const run = follow([
      ...lines('draft', 1, CONSOLE_LINES_PER_RUN + 1),
      {
        seq: CONSOLE_LINES_PER_RUN + 2,
        type: 'stage_state',
        stage: 'draft',
        status: 'passed',
      },
    ]);

    expect(stage(run, 'draft')).toMatchObject({
      status: 'passed',
      dropped: true,
    });
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
