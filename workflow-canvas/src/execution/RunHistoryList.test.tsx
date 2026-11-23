// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunHistoryList } from './RunHistoryList';
import type { RunSummaryRow } from './core/run-history';

function runOf(change: Partial<RunSummaryRow> = {}): RunSummaryRow {
  return {
    run_id: '20261024-0412-a7b3c',
    started_at: '2026-10-24T04:12:05Z',
    status: 'passed',
    goal: 'Plan the CSV export',
    goal_truncated: false,
    ...change,
  };
}

function list() {
  return screen.getByRole('list', { name: 'Past runs' });
}

function rows() {
  return within(list()).getAllByRole('listitem');
}

describe('RunHistoryList', () => {
  it('says there are no runs yet, with no list', () => {
    render(<RunHistoryList runs={[]} />);

    expect(screen.getByRole('heading', { name: 'Past runs' })).toBeTruthy();
    expect(screen.getByText('No runs yet.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists many runs newest first, each with its state, id, start time and goal', () => {
    render(
      <RunHistoryList
        runs={[
          runOf({
            run_id: '20261023-0900-aaaaa',
            started_at: '2026-10-23T09:00:00Z',
            status: 'halted',
            goal: 'First',
          }),
          runOf({
            run_id: '20261025-1000-ccccc',
            started_at: '2026-10-25T10:00:00Z',
            status: 'running',
            goal: 'Third',
          }),
          runOf({
            run_id: '20261024-0412-bbbbb',
            started_at: '2026-10-24T04:12:05Z',
            goal: 'Second',
          }),
        ]}
      />,
    );

    expect(rows().map((row) => row.textContent)).toEqual([
      'Running20261025-1000-ccccc2026-10-25 10:00:00 UTCGoal: Third',
      'Passed20261024-0412-bbbbb2026-10-24 04:12:05 UTCGoal: Second',
      'Halted20261023-0900-aaaaa2026-10-23 09:00:00 UTCGoal: First',
    ]);
    const time = within(rows()[1]!).getByText('2026-10-24 04:12:05 UTC');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe('2026-10-24T04:12:05Z');
  });

  it('says No goal for a run whose goal is empty', () => {
    render(<RunHistoryList runs={[runOf({ goal: '' })]} />);

    expect(within(rows()[0]!).getByText('No goal')).toBeTruthy();
    expect(within(rows()[0]!).queryByText(/Goal:/)).toBeNull();
  });

  it('marks a cut goal for the eye and says it is cut for a screen reader', () => {
    render(
      <RunHistoryList
        runs={[runOf({ goal: 'Plan the CSV exp', goal_truncated: true })]}
      />,
    );
    const goal = within(rows()[0]!).getByText(/Plan the CSV exp/);
    const mark = within(goal).getByText('…');

    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(goal.textContent).toBe('Goal: Plan the CSV exp… (cut short)');
    expect(within(goal).getByText('(cut short)').className).toBe(
      'wf-visually-hidden',
    );
  });

  it('adds no mark to a goal that was not cut', () => {
    render(<RunHistoryList runs={[runOf()]} />);

    expect(within(rows()[0]!).queryByText('…')).toBeNull();
    expect(within(rows()[0]!).queryByText(/cut short/)).toBeNull();
  });

  it('renders a goal with markup in it as plain text', () => {
    const hostile = '<img src=x onerror="document.title=\'owned\'"><b>bold</b>';
    const { container } = render(
      <RunHistoryList runs={[runOf({ goal: hostile })]} />,
    );

    expect(container.querySelector('img, b')).toBeNull();
    expect(
      within(rows()[0]!).getByText(hostile, { exact: false }),
    ).toBeTruthy();
  });
});
