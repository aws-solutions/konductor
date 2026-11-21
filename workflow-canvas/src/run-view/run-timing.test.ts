// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { RunSummaryRow } from '../execution/core/run-history';
import { runTiming } from './run-timing';

const RUN_ID = '20261024-0412-a7b3c';

const row = (over: Partial<RunSummaryRow> = {}): RunSummaryRow => ({
  run_id: RUN_ID,
  started_at: '2026-10-24T04:12:05Z',
  status: 'running',
  goal: 'Add a greeting',
  goal_truncated: false,
  ...over,
});

describe('runTiming', () => {
  it('takes the start time that the list of runs gives', () => {
    expect(runTiming(RUN_ID, [row()], 999)).toEqual({
      startedAt: Date.parse('2026-10-24T04:12:05Z'),
    });
  });

  it('takes the time the page saw the run when the list does not have it', () => {
    expect(
      runTiming(RUN_ID, [row({ run_id: '20261024-0400-bbbbb' })], 999),
    ).toEqual({ startedAt: 999 });
  });

  it('takes the time the page saw the run when the list is empty', () => {
    expect(runTiming(RUN_ID, [], 42)).toEqual({ startedAt: 42 });
  });

  it('takes the time the page saw the run when the start time cannot be read', () => {
    expect(runTiming(RUN_ID, [row({ started_at: 'yesterday' })], 7)).toEqual({
      startedAt: 7,
    });
  });
});
