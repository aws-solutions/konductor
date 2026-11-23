// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseRunEventsAnswer } from './run-events-answer';

const common = { run_id: '20261024-0412-a7b3c', at: '2026-10-24T04:12:05Z' };

const answerWith = (events: unknown[], next = 9, finished = false) => ({
  events,
  next,
  finished,
});

// One valid event of each known type. Each malformed case below changes one
// field of one of them, so it is refused for that field alone.
const STAGE = {
  ...common,
  seq: 1,
  type: 'stage_state',
  stage: 'a',
  status: 'running',
};
const LINE = { ...common, seq: 1, type: 'console', stage: 'a', n: 1, text: '' };
const FINISHED = {
  ...common,
  seq: 1,
  type: 'run_finished',
  status: 'passed',
  exit_code: 0,
};

const one = (event: Record<string, unknown>) => answerWith([event]);

function without(event: Record<string, unknown>, key: string) {
  return Object.fromEntries(
    Object.entries(event).filter(([name]) => name !== key),
  );
}

describe('parseRunEventsAnswer', () => {
  it('reads each known event with the fields the reducer takes', () => {
    const answer = parseRunEventsAnswer(
      answerWith(
        [
          {
            ...common,
            seq: 1,
            type: 'stage_state',
            stage: 'a',
            status: 'running',
          },
          { ...common, seq: 2, type: 'console', stage: 'a', n: 1, text: 'hi' },
          {
            ...common,
            seq: 3,
            type: 'stage_state',
            stage: 'a',
            status: 'blocked',
            reason: 'TIMEOUT',
          },
          {
            ...common,
            seq: 4,
            type: 'run_finished',
            status: 'halted',
            exit_code: 1,
          },
        ],
        4,
        true,
      ),
    );

    expect(answer).toEqual({
      events: [
        { seq: 1, type: 'stage_state', stage: 'a', status: 'running' },
        { seq: 2, type: 'console', stage: 'a', n: 1, text: 'hi' },
        {
          seq: 3,
          type: 'stage_state',
          stage: 'a',
          status: 'blocked',
          reason: 'TIMEOUT',
        },
        {
          seq: 4,
          type: 'run_finished',
          at: '2026-10-24T04:12:05Z',
          status: 'halted',
          exit_code: 1,
        },
      ],
      next: 4,
      finished: true,
    });
  });

  it('keeps an event of a later type as its seq and type only', () => {
    expect(
      parseRunEventsAnswer(
        answerWith([{ ...common, seq: 3, type: 'stage_note', extra: {} }], 3),
      )?.events,
    ).toEqual([{ seq: 3, type: 'stage_note' }]);
  });

  it('reads an answer with no events', () => {
    expect(parseRunEventsAnswer(answerWith([], 6))).toEqual({
      events: [],
      next: 6,
      finished: false,
    });
  });

  it.each([
    ['not an object', 'events'],
    ['no events', { next: 0, finished: false }],
    ['a next that is not whole', { events: [], next: 1.5, finished: false }],
    ['a negative next', { events: [], next: -1, finished: false }],
    [
      'a finished that is not a boolean',
      { events: [], next: 0, finished: 'no' },
    ],
    [
      'a next below the last seq',
      answerWith([{ seq: 4, type: 'stage_note' }], 3),
    ],
    [
      'a seq that does not go up',
      answerWith([
        { seq: 4, type: 'stage_note' },
        { seq: 4, type: 'stage_note' },
      ]),
    ],
    ['a seq of 0', answerWith([{ seq: 0, type: 'stage_note' }])],
    ['an empty type', answerWith([{ seq: 1, type: '' }])],
    ['a stage status of pending', one({ ...STAGE, status: 'pending' })],
    ['a blocked stage with no reason', one({ ...STAGE, status: 'blocked' })],
    [
      'a reason on a stage that is not blocked',
      one({ ...STAGE, status: 'passed', reason: 'TIMEOUT' }),
    ],
    ['a stage_state with no stage', one(without(STAGE, 'stage'))],
    ['a console line numbered 0', one({ ...LINE, n: 0 })],
    ['a console line with no text', one(without(LINE, 'text'))],
    ['a console line with no stage', one(without(LINE, 'stage'))],
    [
      'a run_finished of a running run',
      one({ ...FINISHED, status: 'running' }),
    ],
    ['a run_finished with no at', one(without(FINISHED, 'at'))],
    [
      'a run_finished on a day past the end of its month',
      one({ ...FINISHED, at: '2026-02-30T04:12:05Z' }),
    ],
    [
      'a run_finished at a time that is not a timestamp',
      one({ ...FINISHED, at: 'yesterday' }),
    ],
    ['a run_finished with no exit code', one(without(FINISHED, 'exit_code'))],
    [
      'a run_finished with a negative exit code',
      one({ ...FINISHED, exit_code: -1 }),
    ],
  ])('is undefined for %s', (_, body) => {
    expect(parseRunEventsAnswer(body)).toBeUndefined();
  });

  it.each([
    ['stage_state', STAGE],
    ['console', LINE],
    ['run_finished', FINISHED],
  ])('reads the valid %s that the malformed cases start from', (_, event) => {
    expect(parseRunEventsAnswer(one(event))?.events).toHaveLength(1);
  });
});
