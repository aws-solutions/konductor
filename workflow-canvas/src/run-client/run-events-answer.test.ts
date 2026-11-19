// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseRunEventsAnswer } from './run-events-answer';

const common = { run_id: '20261024-0412-a7b3c', at: '2026-10-24T04:12:05Z' };

const answerWith = (events: unknown[], next = 9, finished = false) => ({
  events,
  next,
  finished,
});

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
        { seq: 4, type: 'run_finished', status: 'halted', exit_code: 1 },
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
    [
      'a stage status of pending',
      answerWith([
        { seq: 1, type: 'stage_state', stage: 'a', status: 'pending' },
      ]),
    ],
    [
      'a blocked stage with no reason',
      answerWith([
        { seq: 1, type: 'stage_state', stage: 'a', status: 'blocked' },
      ]),
    ],
    [
      'a reason on a stage that is not blocked',
      answerWith([
        {
          seq: 1,
          type: 'stage_state',
          stage: 'a',
          status: 'passed',
          reason: 'TIMEOUT',
        },
      ]),
    ],
    [
      'a console line numbered 0',
      answerWith([{ seq: 1, type: 'console', stage: 'a', n: 0, text: '' }]),
    ],
    [
      'a console line with no text',
      answerWith([{ seq: 1, type: 'console', stage: 'a', n: 1 }]),
    ],
    [
      'a run_finished of a running run',
      answerWith([
        { seq: 1, type: 'run_finished', status: 'running', exit_code: 0 },
      ]),
    ],
    [
      'a run_finished with no exit code',
      answerWith([{ seq: 1, type: 'run_finished', status: 'passed' }]),
    ],
    [
      'a run_finished with a negative exit code',
      answerWith([
        { seq: 1, type: 'run_finished', status: 'halted', exit_code: -1 },
      ]),
    ],
  ])('is undefined for %s', (_, body) => {
    expect(parseRunEventsAnswer(body)).toBeUndefined();
  });
});
