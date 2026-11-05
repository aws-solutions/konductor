// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { parseRunList } from './parse';

const RUN = {
  run_id: '20261024-0412-a7b3c',
  started_at: '2026-10-24T04:12:05Z',
  status: 'passed',
  goal: 'Add a greeting to the README',
  goal_truncated: false,
  future_field: true,
};

// The run above with some keys replaced; `undefined` leaves a key out.
const runWith = (change: Record<string, unknown>) => ({
  runs: [{ ...RUN, ...change }],
});

describe('parseRunList', () => {
  it('reads each run of the list, in the order the server sent them', () => {
    const older = { ...RUN, run_id: '20261023-0900-b8c4d', status: 'halted' };

    expect(parseRunList({ runs: [RUN, older], future_field: 1 })).toEqual([
      {
        run_id: '20261024-0412-a7b3c',
        started_at: '2026-10-24T04:12:05Z',
        status: 'passed',
        goal: 'Add a greeting to the README',
        goal_truncated: false,
      },
      {
        run_id: '20261023-0900-b8c4d',
        started_at: '2026-10-24T04:12:05Z',
        status: 'halted',
        goal: 'Add a greeting to the README',
        goal_truncated: false,
      },
    ]);
  });

  it('reads an empty list', () => {
    expect(parseRunList({ runs: [] })).toEqual([]);
  });

  it('reads a goal that was cut, and an empty goal', () => {
    expect(
      parseRunList(runWith({ goal: 'Plan the CSV exp', goal_truncated: true })),
    ).toMatchObject([{ goal: 'Plan the CSV exp', goal_truncated: true }]);
    expect(parseRunList(runWith({ goal: '' }))).toMatchObject([{ goal: '' }]);
  });

  it.each([
    ['no goal_truncated', undefined],
    ['a goal_truncated that is null', null],
    ['a goal_truncated that is a string', 'true'],
    ['a goal_truncated that is a number', 1],
  ])('fails on a run with %s', (_, goal_truncated) => {
    expect(() => parseRunList(runWith({ goal_truncated }))).toThrow(ApiError);
  });

  it.each([
    ['no run_id', { run_id: undefined }],
    ['a run_id that is not a run id', { run_id: 'run-1' }],
    ['no started_at', { started_at: undefined }],
    ['a started_at that is a number', { started_at: 1 }],
    ['no status', { status: undefined }],
    ['a status it does not know', { status: 'paused' }],
    ['no goal', { goal: undefined }],
    ['a goal that is a number', { goal: 7 }],
  ])('fails on a run with %s', (_, change) => {
    expect(() => parseRunList(runWith(change))).toThrow(ApiError);
  });

  it.each([
    ['no runs', {}],
    ['runs that are an object', { runs: {} }],
    ['a run that is a string', { runs: ['x'] }],
    ['a body that is a list', []],
  ])('fails on %s', (_, body) => {
    expect(() => parseRunList(body)).toThrow(ApiError);
  });
});
