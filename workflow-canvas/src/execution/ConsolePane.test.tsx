// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsolePane } from './ConsolePane';
import {
  applyRunEvents,
  CONSOLE_LINES_PER_RUN,
  startFollowing,
  type ConsoleLine,
  type FollowedStage,
  type RunEvent,
} from './core/run-follow';

const LINES: ConsoleLine[] = [
  { n: 1, text: 'Reading the goal' },
  { n: 2, text: 'Writing PLAN.md' },
];

function stageWith(change: Partial<FollowedStage> = {}): FollowedStage {
  return {
    name: 'draft',
    status: 'running',
    console: LINES,
    dropped: false,
    ...change,
  };
}

function renderPane(change: Partial<FollowedStage> = {}, runFinished = false) {
  return render(
    <ConsolePane stage={stageWith(change)} runFinished={runFinished} />,
  );
}

function shownLines(): string[] {
  const region = screen.getByRole('region', { name: 'Console lines of draft' });
  return within(region)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.wf-code-text')?.textContent ?? '');
}

const NOT_SHOWN = 'Earlier lines are not shown.';

describe('ConsolePane', () => {
  it('shows the lines of the stage in order', () => {
    renderPane();

    expect(
      screen.getByRole('heading', { name: 'Console: draft' }),
    ).toBeTruthy();
    expect(shownLines()).toEqual(['Reading the goal', 'Writing PLAN.md']);
  });

  it('says the lines are live only and not saved, and ties that to the lines', () => {
    renderPane();
    const note = screen.getByText('Live only, not saved.');
    const region = screen.getByRole('region', {
      name: 'Console lines of draft',
    });

    expect(region.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('renders hostile markup as plain text', () => {
    const hostile = [
      '<img src=x onerror="document.title=\'owned\'">',
      '<script>document.title="owned"</script>',
      '<b>not bold</b> &amp; &lt;',
    ];
    const { container } = renderPane({
      console: hostile.map((text, index) => ({ n: index + 1, text })),
    });

    expect(container.querySelector('img, script, b')).toBeNull();
    expect(shownLines()).toEqual(hostile);
  });

  it('can be scrolled with the keyboard', () => {
    renderPane();
    const region = screen.getByRole('region', {
      name: 'Console lines of draft',
    });

    region.focus();

    expect(region.tabIndex).toBe(0);
    expect(document.activeElement).toBe(region);
  });

  it('hides the line numbers from a screen reader', () => {
    const { container } = renderPane();
    const numbers = [...container.querySelectorAll('.wf-code-n')];

    expect(numbers.map((n) => n.textContent)).toEqual(['1', '2']);
    expect(numbers.every((n) => n.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
  });

  it('says earlier lines are not shown when the stage is marked dropped', () => {
    renderPane({ console: [{ n: 6, text: 'later line' }], dropped: true });

    expect(screen.getByText(NOT_SHOWN)).toBeTruthy();
  });

  it('says nothing was dropped when the stage is not marked dropped', () => {
    renderPane();

    expect(screen.queryByText(NOT_SHOWN)).toBeNull();
  });

  it('says so after the run-wide cap drops lines of the stage', () => {
    const over = CONSOLE_LINES_PER_RUN + 3;
    const events: RunEvent[] = Array.from({ length: over }, (_, index) => ({
      seq: index + 1,
      type: 'console',
      stage: 'draft',
      n: index + 1,
      text: `line ${index + 1}`,
    }));
    const run = applyRunEvents(startFollowing(['draft']), events);

    render(<ConsolePane stage={run.stages[0]!} runFinished={false} />);

    expect(screen.getByText(NOT_SHOWN)).toBeTruthy();
    expect(shownLines()).toHaveLength(CONSOLE_LINES_PER_RUN);
  });

  describe('with no line', () => {
    it.each<[string, FollowedStage['status']]>([
      ['pending', 'pending'],
      ['running', 'running'],
    ])(
      'says there is no output yet while a %s stage can still print',
      (_, status) => {
        renderPane({ status, console: [] });

        expect(screen.getByText('No output yet.')).toBeTruthy();
        expect(
          screen.queryByRole('region', { name: /Console lines/ }),
        ).toBeNull();
      },
    );

    it('says no live output is available once the run has finished', () => {
      // A finished run's events carry no console lines.
      renderPane({ status: 'passed', console: [] }, true);

      expect(screen.getByText('No live output is available.')).toBeTruthy();
      expect(screen.queryByText('No output yet.')).toBeNull();
    });

    it('says no live output is available for a running stage of a finished run', () => {
      // As after the server started again and the run was ended.
      renderPane({ status: 'running', console: [] }, true);

      expect(screen.getByText('No live output is available.')).toBeTruthy();
    });

    it.each<[string, FollowedStage['status']]>([
      ['passed', 'passed'],
      ['blocked', 'blocked'],
    ])(
      'says no live output is available for a %s stage while the run goes on',
      (_, status) => {
        renderPane({ status, console: [] });

        expect(screen.getByText('No live output is available.')).toBeTruthy();
      },
    );

    it('says no live output is available when the cap dropped every line of the stage', () => {
      const run = applyRunEvents(startFollowing(['draft', 'review']), [
        { seq: 1, type: 'console', stage: 'draft', n: 1, text: 'old' },
        ...Array.from(
          { length: CONSOLE_LINES_PER_RUN },
          (_, index): RunEvent => ({
            seq: index + 2,
            type: 'console',
            stage: 'review',
            n: index + 1,
            text: `line ${index + 1}`,
          }),
        ),
      ]);

      render(<ConsolePane stage={run.stages[0]!} runFinished={false} />);

      expect(screen.getByText('No live output is available.')).toBeTruthy();
      expect(screen.queryByText(NOT_SHOWN)).toBeNull();
    });
  });
});
