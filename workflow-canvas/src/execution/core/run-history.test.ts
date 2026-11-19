// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  historyRows,
  RUN_HISTORY_LIMIT,
  runStateWord,
  startedText,
  type RunSummaryRow,
} from './run-history';

const run = (run_id: string, started_at: string): RunSummaryRow => ({
  run_id,
  started_at,
  status: 'passed',
  goal: 'g',
  goal_truncated: false,
});

describe('historyRows', () => {
  it('puts the newest run first', () => {
    const rows = historyRows([
      run('b', '2026-10-24T04:12:05Z'),
      run('c', '2026-10-25T00:00:00Z'),
      run('a', '2026-10-23T23:59:59Z'),
    ]);

    expect(rows.map((row) => row.run_id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps the order of the server for runs that started in the same second', () => {
    const at = '2026-10-24T04:12:05Z';
    const rows = historyRows([run('later', at), run('earlier', at)]);

    expect(rows.map((row) => row.run_id)).toEqual(['later', 'earlier']);
  });

  it('keeps at most the limit, the newest ones', () => {
    const runs = Array.from({ length: RUN_HISTORY_LIMIT + 5 }, (_, i) =>
      run(
        `r${i}`,
        `2026-10-24T04:${String(i % 60).padStart(2, '0')}:${String(Math.floor(i / 60)).padStart(2, '0')}Z`,
      ),
    );
    const rows = historyRows(runs);

    expect(rows).toHaveLength(RUN_HISTORY_LIMIT);
    expect(rows[0]?.started_at).toBe('2026-10-24T04:59:02Z');
  });

  it('leaves its input as it was', () => {
    const runs = [
      run('a', '2026-10-23T00:00:00Z'),
      run('b', '2026-10-24T00:00:00Z'),
    ];
    historyRows(runs);

    expect(runs.map((row) => row.run_id)).toEqual(['a', 'b']);
  });
});

describe('runStateWord', () => {
  it.each([
    ['running', 'Running'],
    ['passed', 'Passed'],
    ['halted', 'Halted'],
  ] as const)('says %s as %s', (status, word) => {
    expect(runStateWord(status)).toBe(word);
  });
});

describe('startedText', () => {
  it('shows a time of the contract as a date and a UTC time', () => {
    expect(startedText('2026-10-24T04:12:05Z')).toBe('2026-10-24 04:12:05 UTC');
  });

  it('shows any other value as it is', () => {
    expect(startedText('yesterday')).toBe('yesterday');
  });
});
