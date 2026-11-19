// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StageDetail } from './StageDetail';
import type { FollowedStage } from './core/run-follow';

function stageOf(change: Partial<FollowedStage> = {}): FollowedStage {
  return {
    name: 'draft',
    status: 'running',
    console: [{ n: 1, text: 'Reading the goal' }],
    dropped: false,
    ...change,
  };
}

const reasonSentence = (code: string) =>
  code === 'RESULT_MISSING'
    ? 'The final message of the session has no result line.'
    : undefined;

function renderDetail(
  change: Partial<FollowedStage> = {},
  runFinished = false,
) {
  return render(
    <StageDetail
      stage={stageOf(change)}
      runFinished={runFinished}
      reasonSentence={reasonSentence}
    />,
  );
}

function detail() {
  return screen.getByRole('region', { name: 'draft' });
}

describe('StageDetail', () => {
  it('is a region named by a heading that says the stage name', () => {
    renderDetail();

    expect(
      screen.getByRole('heading', { level: 2, name: 'draft' }),
    ).toBeTruthy();
    expect(detail()).toBeTruthy();
  });

  it.each([
    [{ status: 'pending' as const }, false, 'Queued'],
    [{ status: 'pending' as const }, true, 'Not run'],
    [{ status: 'running' as const }, false, 'Running'],
    [{ status: 'passed' as const }, true, 'Passed'],
  ])(
    'says the state of the stage (%o, run finished: %s) as %s, with no reason',
    (change, finished, word) => {
      renderDetail(change, finished);

      expect(within(detail()).getByText('State:').textContent).toBe(
        `State: ${word}`,
      );
      expect(
        within(detail()).queryByText(/stopped the run|result line/),
      ).toBeNull();
    },
  );

  it('says why a blocked stage stopped the run', () => {
    renderDetail({ status: 'blocked', reason: 'RESULT_MISSING' }, true);

    expect(within(detail()).getByText('State:').textContent).toBe(
      'State: Blocked',
    );
    expect(
      within(detail()).getByText(
        'The final message of the session has no result line.',
      ),
    ).toBeTruthy();
  });

  it('names a reason code that has no sentence', () => {
    renderDetail({ status: 'blocked', reason: 'LATER_CODE' }, true);

    expect(
      within(detail()).getByText(
        'The stage stopped the run with the reason LATER_CODE.',
      ),
    ).toBeTruthy();
  });

  it('shows the console of the stage', () => {
    renderDetail();
    const lines = within(detail()).getByRole('region', {
      name: 'Console lines of draft',
    });

    expect(within(lines).getByText('Reading the goal')).toBeTruthy();
  });

  it('passes on that the run finished, so the console says its lines are gone', () => {
    renderDetail({ status: 'passed', console: [] }, true);

    expect(
      within(detail()).getByText('No live output is available.'),
    ).toBeTruthy();
  });

  it('renders markup in a reason or a name as plain text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <StageDetail
        stage={stageOf({ name: hostile, status: 'blocked', reason: hostile })}
        runFinished
        reasonSentence={() => undefined}
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(hostile);
  });
});
