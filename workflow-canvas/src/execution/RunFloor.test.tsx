// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunFloor } from './RunFloor';
import {
  applyRunEvents,
  startFollowing,
  type FollowedRun,
  type RunEvent,
} from './core/run-follow';
import type { RunSummaryRow } from './core/run-history';
import { runProgress } from './core/run-progress';

const reasonSentence = (code: string) =>
  code === 'TIMEOUT' ? 'The stage ran out of time.' : undefined;

const line = (
  seq: number,
  stage: string,
  n: number,
  text: string,
): RunEvent => ({
  seq,
  type: 'console',
  stage,
  n,
  text,
});

function runWith(events: RunEvent[]): FollowedRun {
  return applyRunEvents(startFollowing(['draft', 'review']), events);
}

const RUNNING = runWith([
  { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
  line(2, 'draft', 1, 'Reading the goal'),
  { seq: 3, type: 'stage_state', stage: 'draft', status: 'passed' },
  { seq: 4, type: 'stage_state', stage: 'review', status: 'running' },
  line(5, 'review', 1, 'Reading PLAN.md'),
]);

const HISTORY: RunSummaryRow[] = [
  {
    run_id: '20261024-0412-a7b3c',
    started_at: '2026-10-24T04:12:05Z',
    status: 'running',
    goal: 'Plan the export',
    goal_truncated: false,
  },
];

const RUN_ID = '20261024-0412-a7b3c';

function floor(
  run: FollowedRun | undefined,
  { runId = RUN_ID, ended = false } = {},
) {
  return (
    <RunFloor
      run={run}
      runId={run ? runId : undefined}
      progress={
        run
          ? runProgress(run, { startedAt: 0 }, () => 65_000, { ended })
          : undefined
      }
      history={HISTORY}
      ended={ended}
      reasonSentence={reasonSentence}
    />
  );
}

function renderFloor(run: FollowedRun | undefined, ended = false) {
  return render(floor(run, { ended }));
}

const stageButton = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) });
const detail = (name: string) => screen.getByRole('region', { name });
const consoleBox = (name: string) =>
  screen.getByRole('region', { name: `Console lines of ${name}` });

describe('RunFloor when the run is over with no last event', () => {
  it('says the run ended instead of naming a stage at work', () => {
    renderFloor(RUNNING, true);

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'The run ended. 1 of 2 stages passed.',
    );
  });

  it('shows the stage that was running as not finished', () => {
    renderFloor(RUNNING, true);

    const stages = within(
      screen.getByRole('region', { name: 'Stages' }),
    ).getAllByRole('button');
    expect(stages.map((button) => button.textContent)).toEqual([
      'draftPassed',
      'reviewNot finished',
    ]);
  });

  it('says that no more console lines can come', () => {
    renderFloor(runWith([]), true);

    expect(
      within(detail('draft')).getByText('No live output is available.'),
    ).toBeTruthy();
  });
});

describe('RunFloor', () => {
  it('shows the progress, the stages, the detail of the stage at work and the past runs', () => {
    renderFloor(RUNNING);

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Running review. 1 of 2 stages passed.',
    );
    const stages = within(
      screen.getByRole('region', { name: 'Stages' }),
    ).getAllByRole('button');
    expect(stages.map((button) => button.textContent)).toEqual([
      'draftPassed',
      'reviewRunning',
    ]);
    expect(stageButton('review').getAttribute('aria-current')).toBe('true');
    expect(
      within(consoleBox('review')).getByText('Reading PLAN.md'),
    ).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Past runs' })).toBeTruthy();
  });

  it('shows the detail of a stage that is picked, and keeps focus on its button', () => {
    renderFloor(RUNNING);
    const draft = stageButton('draft');
    draft.focus();
    fireEvent.click(draft);

    expect(draft.getAttribute('aria-current')).toBe('true');
    expect(stageButton('review').getAttribute('aria-current')).toBeNull();
    expect(detail('draft')).toBeTruthy();
    expect(
      within(consoleBox('draft')).getByText('Reading the goal'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(draft);
  });

  it('starts the console afresh for each stage it switches to', () => {
    renderFloor(RUNNING);
    const before = consoleBox('review');
    fireEvent.click(stageButton('draft'));
    const draftBox = consoleBox('draft');
    fireEvent.click(stageButton('review'));

    expect(draftBox).not.toBe(before);
    expect(consoleBox('review')).not.toBe(before);
    expect(screen.queryByText('Reading the goal')).toBeNull();
  });

  it('keeps the pick as the run goes on', () => {
    const { rerender } = renderFloor(RUNNING);
    fireEvent.click(stageButton('draft'));
    const later = applyRunEvents(RUNNING, [line(6, 'review', 2, 'More')]);
    rerender(floor(later));

    expect(stageButton('draft').getAttribute('aria-current')).toBe('true');
  });

  it('drops the pick when the floor moves to another run', () => {
    const { rerender } = renderFloor(RUNNING);
    fireEvent.click(stageButton('draft'));
    expect(stageButton('draft').getAttribute('aria-current')).toBe('true');

    const second = runWith([
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'passed' },
      { seq: 2, type: 'stage_state', stage: 'review', status: 'running' },
    ]);
    rerender(floor(second, { runId: '20261024-0501-b8c4d' }));

    expect(stageButton('review').getAttribute('aria-current')).toBe('true');
    expect(stageButton('draft').getAttribute('aria-current')).toBeNull();
  });

  it('says a run with no stages has none, and one not started yet', () => {
    const { unmount } = renderFloor(startFollowing([]));

    expect(screen.getByText('This run has no stages.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Stages' })).toBeNull();
    unmount();

    renderFloor(undefined);
    expect(screen.getByText('No run yet.')).toBeTruthy();
    expect(screen.queryByTestId('run-progress')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Past runs' })).toBeTruthy();
  });

  it('shows a finished run with its blocked stage, its reason and the stages it did not run', () => {
    const halted = runWith([
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
      {
        seq: 2,
        type: 'stage_state',
        stage: 'draft',
        status: 'blocked',
        reason: 'TIMEOUT',
      },
      {
        seq: 3,
        type: 'run_finished',
        at: '2026-10-24T04:13:05Z',
        status: 'halted',
        exit_code: 1,
      },
    ]);
    renderFloor(halted);

    expect(stageButton('draft').getAttribute('aria-current')).toBe('true');
    expect(stageButton('review').textContent).toBe('reviewNot run');
    expect(
      within(detail('draft')).getByText('The stage ran out of time.'),
    ).toBeTruthy();
    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Run halted at draft.',
    );
  });

  it('adds no live region', () => {
    const { container } = renderFloor(RUNNING);

    expect(
      container.querySelector('[aria-live], [role="status"], [role="alert"]'),
    ).toBeNull();
  });
});
