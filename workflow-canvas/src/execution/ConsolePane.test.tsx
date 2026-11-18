// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsolePane } from './ConsolePane';
import {
  applyRunEvents,
  CONSOLE_LINES_PER_STAGE,
  startFollowing,
  type ConsoleLine,
  type RunEvent,
} from './core/run-follow';

const LINES: ConsoleLine[] = [
  { n: 1, text: 'Reading the goal' },
  { n: 2, text: 'Writing PLAN.md' },
];

function shownLines(): string[] {
  const region = screen.getByRole('region', { name: 'Console lines of draft' });
  return within(region)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.wf-code-text')?.textContent ?? '');
}

describe('ConsolePane', () => {
  it('shows the lines of the stage in order', () => {
    render(<ConsolePane stage="draft" lines={LINES} />);

    expect(
      screen.getByRole('heading', { name: 'Console: draft' }),
    ).toBeTruthy();
    expect(shownLines()).toEqual(['Reading the goal', 'Writing PLAN.md']);
  });

  it('says the lines are live only and not saved, and ties that to the lines', () => {
    render(<ConsolePane stage="draft" lines={LINES} />);
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
    const { container } = render(
      <ConsolePane
        stage="draft"
        lines={hostile.map((text, index) => ({ n: index + 1, text }))}
      />,
    );

    expect(container.querySelector('img, script, b')).toBeNull();
    expect(shownLines()).toEqual(hostile);
  });

  it('can be scrolled with the keyboard', () => {
    render(<ConsolePane stage="draft" lines={LINES} />);
    const region = screen.getByRole('region', {
      name: 'Console lines of draft',
    });

    region.focus();

    expect(region.tabIndex).toBe(0);
    expect(document.activeElement).toBe(region);
  });

  it('hides the line numbers from a screen reader', () => {
    const { container } = render(<ConsolePane stage="draft" lines={LINES} />);
    const numbers = [...container.querySelectorAll('.wf-code-n')];

    expect(numbers.map((n) => n.textContent)).toEqual(['1', '2']);
    expect(numbers.every((n) => n.getAttribute('aria-hidden') === 'true')).toBe(
      true,
    );
  });

  it.each([
    [2, '1 earlier line is not shown.'],
    [6, '5 earlier lines are not shown.'],
  ])('says so when the first line held is line %i', (first, text) => {
    render(
      <ConsolePane stage="draft" lines={[{ n: first, text: 'later line' }]} />,
    );

    expect(screen.getByText(text)).toBeTruthy();
  });

  it('says nothing was dropped when the first line is held', () => {
    render(<ConsolePane stage="draft" lines={LINES} />);

    expect(screen.queryByText(/earlier lines? (is|are) not shown/)).toBeNull();
  });

  it('says how many lines the buffer of the run dropped', () => {
    const over = CONSOLE_LINES_PER_STAGE + 3;
    const events: RunEvent[] = Array.from({ length: over }, (_, index) => ({
      seq: index + 1,
      type: 'console',
      stage: 'draft',
      n: index + 1,
      text: `line ${index + 1}`,
    }));
    const run = applyRunEvents(startFollowing(['draft']), events);

    render(<ConsolePane stage="draft" lines={run.stages[0]!.console} />);

    expect(screen.getByText('3 earlier lines are not shown.')).toBeTruthy();
    expect(shownLines()).toHaveLength(CONSOLE_LINES_PER_STAGE);
  });

  it('says there is no output before the first line', () => {
    render(<ConsolePane stage="draft" lines={[]} />);

    expect(screen.getByText('No output yet.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Console lines/ })).toBeNull();
  });
});
