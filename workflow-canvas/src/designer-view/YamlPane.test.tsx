// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as textLinesModule from './text-lines';
import { YAML_WINDOW_LINES } from './line-window';
import { BLOCK, FLOW, STAGES_FIRST, type SampleText } from './sample-texts';
import { YamlPane, type MarkedStage } from './YamlPane';

function renderPane(sample: SampleText, stage?: MarkedStage) {
  return render(<YamlPane file="hello.yml" text={sample.text} stage={stage} />);
}

function regionOf(file = 'hello.yml'): HTMLElement {
  return screen.getByRole('region', { name: `Lines of ${file}` });
}

// The rows of a region, found by class rather than by the `listitem` role: the
// role query costs about 200 ms over a 500-row window, enough on its own to
// push the long-file cases past the 5 s test timeout. 'exposes each line as a
// list item' below pins the two queries to the same elements.
function rowsIn(region: HTMLElement): HTMLElement[] {
  return [...region.querySelectorAll<HTMLElement>('li.wf-code-line')];
}

function items(): HTMLElement[] {
  return rowsIn(regionOf());
}

// The line number that a row shows.
function numberOf(item: HTMLElement): number {
  return Number(item.querySelector('.wf-code-n')?.textContent);
}

// The numbers of the lines whose attribute `name` is "true".
function linesWith(name: string): number[] {
  return items()
    .filter((item) => item.getAttribute(name) === 'true')
    .map(numberOf);
}

// The notes of the pane other than the read-only note in its head.
function windowNotes(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(':scope > section > p.wf-code-note'),
  ].map((note) => note.textContent ?? '');
}

// A text of `total` lines: line n is `line n`.
function numbered(total: number): string {
  return Array.from({ length: total }, (_, index) => `line ${index + 1}`).join(
    '\n',
  );
}

const FILE_LIMIT_BYTES = 262_144;

const marked = () => linesWith('data-marked');
const current = () => linesWith('aria-current');

function stageOf(sample: SampleText, name: string): MarkedStage {
  const stage = sample.stages.find((each) => each.name === name);
  if (!stage) throw new Error(`No stage ${name}`);
  return stage;
}

describe('YamlPane', () => {
  it('shows each line of the file with its number', () => {
    const { container } = renderPane(BLOCK);

    expect(items()).toHaveLength(13);
    expect(items()[6]?.querySelector('.wf-code-text')?.textContent).toBe(
      '  - name: draft',
    );
    expect(container.querySelector('.wf-code-n')?.textContent).toBe('1');
  });

  it('exposes each line as a list item', () => {
    renderPane(BLOCK);
    const byRole = within(regionOf()).getAllByRole('listitem');
    const byClass = items();

    expect(byRole).toHaveLength(13);
    expect(byClass).toHaveLength(13);
    byRole.forEach((row, index) => expect(byClass[index]).toBe(row));
  });

  it('marks nothing and says only that it is read-only without a stage', () => {
    renderPane(BLOCK);

    expect(marked()).toEqual([]);
    expect(current()).toEqual([]);
    expect(screen.getByText('Read-only.')).toBeTruthy();
  });

  it('marks a stage at the top of the file', () => {
    renderPane(STAGES_FIRST, stageOf(STAGES_FIRST, 'draft'));

    expect(marked()).toEqual([2, 3]);
    expect(current()).toEqual([2]);
    expect(items()).toHaveLength(8);
  });

  it('marks a stage in the middle of the file', () => {
    renderPane(BLOCK, stageOf(BLOCK, 'review'));

    expect(marked()).toEqual([10, 11]);
    expect(current()).toEqual([10]);
  });

  it('marks the stage at the end of the file', () => {
    renderPane(BLOCK, stageOf(BLOCK, 'wrap-up'));

    expect(marked()).toEqual([12, 13]);
    expect(current()).toEqual([12]);
    expect(items()).toHaveLength(13);
  });

  it('marks the one line of a stage in flow form', () => {
    renderPane(FLOW, stageOf(FLOW, 'review'));

    expect(marked()).toEqual([6]);
    expect(current()).toEqual([6]);
  });

  it('says which lines are marked, and ties that to the lines', () => {
    renderPane(BLOCK, stageOf(BLOCK, 'draft'));
    const note = screen.getByText('Read-only. Lines 7 to 9 are stage draft.');
    const region = regionOf();

    expect(region.getAttribute('aria-describedby')).toBe(note.id);
  });

  it('says so for a stage of one line', () => {
    renderPane(FLOW, stageOf(FLOW, 'draft'));

    expect(screen.getByText('Read-only. Line 6 is stage draft.')).toBeTruthy();
  });

  it('renders markup in the file as plain text', () => {
    const text = 'intent:\n  outcome: <img src=x onerror="alert(1)">\n';
    const { container } = render(<YamlPane file="hello.yml" text={text} />);

    expect(container.querySelector('img')).toBeNull();
    expect(items()[1]?.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('can be scrolled with the keyboard', () => {
    renderPane(BLOCK);
    const region = regionOf();

    region.focus();

    expect(region.tabIndex).toBe(0);
    expect(document.activeElement).toBe(region);
  });

  describe('with a long file', () => {
    it('renders a small file whole, with no window note', () => {
      const { container } = renderPane(BLOCK, stageOf(BLOCK, 'review'));

      expect(items().map(numberOf)).toEqual(
        Array.from({ length: 13 }, (_, index) => index + 1),
      );
      expect(windowNotes(container)).toEqual([]);
    });

    it('mounts at most the window for a file near the size limit', () => {
      // Blank lines are one byte each, so this is about as many lines as a
      // file may have.
      const text = `stages:\n  - name: draft\n${'\n'.repeat(FILE_LIMIT_BYTES - 24)}`;
      const total = text.split('\n').length - 1;
      const { container } = render(<YamlPane file="hello.yml" text={text} />);

      expect(total).toBeGreaterThan(262_000);
      expect(items()).toHaveLength(YAML_WINDOW_LINES);
      expect(container.querySelectorAll('li')).toHaveLength(YAML_WINDOW_LINES);
      expect(numberOf(items()[0]!)).toBe(1);
      expect(windowNotes(container)).toEqual([
        `Show lines ${(YAML_WINDOW_LINES + 1).toLocaleString('en-US')} to ${(2 * YAML_WINDOW_LINES).toLocaleString('en-US')}`,
      ]);
    });

    it('centres the window on a range near the middle and notes both sides', () => {
      const { container } = render(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'draft', range: { line: 1500, end_line: 1501 } }}
        />,
      );

      expect(items()).toHaveLength(YAML_WINDOW_LINES);
      expect(marked()).toEqual([1500, 1501]);
      expect(current()).toEqual([1500]);
      expect(numberOf(items()[0]!)).toBe(1251);
      expect(windowNotes(container)).toEqual([
        'Show lines 751 to 1,250',
        'Show lines 1,751 to 2,250',
      ]);
    });

    it('still shows a range near the end of the file', () => {
      const { container } = render(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'wrap-up', range: { line: 2998, end_line: 3000 } }}
        />,
      );

      expect(marked()).toEqual([2998, 2999, 3000]);
      expect(numberOf(items().at(-1)!)).toBe(3000);
      expect(items()[2998 - 2501]?.textContent).toContain('line 2998');
      expect(windowNotes(container)).toEqual(['Show lines 2,001 to 2,500']);
    });

    it('shows the first lines of a range longer than the window and says it continues', () => {
      const { container } = render(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'draft', range: { line: 100, end_line: 1200 } }}
        />,
      );

      expect(items()).toHaveLength(YAML_WINDOW_LINES);
      expect(numberOf(items()[0]!)).toBe(100);
      expect(current()).toEqual([100]);
      expect(marked()).toHaveLength(YAML_WINDOW_LINES);
      expect(windowNotes(container)).toEqual([
        'Show lines 1 to 99',
        'Stage draft continues. Show lines 600 to 1,099',
      ]);
      expect(
        screen.getByText('Read-only. Lines 100 to 1,200 are stage draft.').id,
      ).toBe(regionOf().getAttribute('aria-describedby'));
    });

    it('offers a single line that is not shown', () => {
      const { container } = render(
        <YamlPane file="hello.yml" text={numbered(YAML_WINDOW_LINES + 1)} />,
      );

      expect(windowNotes(container)).toEqual([
        `Show line ${YAML_WINDOW_LINES + 1}`,
      ]);
    });

    it('offers the lines before and after the window as named buttons', () => {
      render(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'draft', range: { line: 1500, end_line: 1501 } }}
        />,
      );

      expect(
        screen.getByRole('button', { name: 'Show lines 751 to 1,250' }),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Show lines 1,751 to 2,250' }),
      ).toBeTruthy();
    });

    it('moves down and back up to the first window, with the true line numbers', () => {
      render(<YamlPane file="hello.yml" text={numbered(3000)} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      expect(numberOf(items()[0]!)).toBe(501);
      expect(items()[0]?.textContent).toContain('line 501');
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 1 to 500' }),
      );
      expect(numberOf(items()[0]!)).toBe(1);
      expect(items()).toHaveLength(YAML_WINDOW_LINES);
    });

    it('starts another file of the same length and range at its first window', () => {
      const range = { line: 10, end_line: 12 };
      const view = render(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'draft', range }}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      expect(numberOf(items()[0]!)).toBe(501);

      view.rerender(
        <YamlPane
          file="other.yml"
          text={numbered(3000)}
          stage={{ name: 'draft', range }}
        />,
      );
      const region = regionOf('other.yml');
      const first = rowsIn(region)[0]!;
      expect(numberOf(first)).toBe(1);
    });

    it('starts at the window of another stage of the same file with the same range', () => {
      const range = { line: 10, end_line: 12 };
      const view = render(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'draft', range }}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      expect(numberOf(items()[0]!)).toBe(501);

      view.rerender(
        <YamlPane
          file="hello.yml"
          text={numbered(3000)}
          stage={{ name: 'review', range }}
        />,
      );
      expect(numberOf(items()[0]!)).toBe(1);
    });

    it('starts another file scrolled to its top', () => {
      const view = render(<YamlPane file="hello.yml" text={numbered(3000)} />);
      const before = regionOf();
      before.scrollTop = 400;

      view.rerender(<YamlPane file="other.yml" text={numbered(3000)} />);
      const after = regionOf('other.yml');
      expect(after).not.toBe(before);
      expect(after.scrollTop).toBe(0);
    });

    describe('the scroll of the box after a move', () => {
      const ROW_PX = 20;
      const BOX_PX = 300;
      const BOX_TOP = 100;
      const real = Element.prototype.getBoundingClientRect;

      // jsdom lays nothing out: the box sits at BOX_TOP, BOX_PX high, and each
      // row is ROW_PX high, placed by its place in the list and the box scroll.
      beforeEach(() => {
        Element.prototype.getBoundingClientRect = function (this: Element) {
          const box = this.closest('.wf-code-scroll') as HTMLElement | null;
          if (this.classList.contains('wf-code-scroll')) {
            return { top: BOX_TOP, bottom: BOX_TOP + BOX_PX } as DOMRect;
          }
          if (this.tagName === 'LI' && box) {
            const index = [...box.querySelectorAll('li')].indexOf(
              this as HTMLLIElement,
            );
            const top = BOX_TOP + index * ROW_PX - box.scrollTop;
            return { top, bottom: top + ROW_PX } as DOMRect;
          }
          return real.call(this);
        };
      });
      afterEach(() => {
        Element.prototype.getBoundingClientRect = real;
      });

      const box = () => regionOf();

      it('shows the first new line at the top after a move forward', () => {
        render(<YamlPane file="hello.yml" text={numbered(3000)} />);
        box().scrollTop = 500 * ROW_PX - BOX_PX;

        fireEvent.click(
          screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
        );
        // Line 501 is the first row of the new window.
        expect(box().scrollTop).toBe(0);
        expect(numberOf(items()[0]!)).toBe(501);
      });

      it('shows the last new line at the bottom after a move back', () => {
        render(<YamlPane file="hello.yml" text={numbered(3000)} />);
        fireEvent.click(
          screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
        );
        box().scrollTop = 0;

        fireEvent.click(
          screen.getByRole('button', { name: 'Show lines 1 to 500' }),
        );
        // Line 500, the last new line, is row 500 of the window 1 to 500.
        expect(box().scrollTop).toBe(500 * ROW_PX - BOX_PX);
        expect(numberOf(items()[0]!)).toBe(1);
      });

      it('keeps the scroll when the focus goes to the first new line', () => {
        render(<YamlPane file="hello.yml" text={numbered(1200)} />);
        fireEvent.click(
          screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
        );
        fireEvent.click(
          screen.getByRole('button', { name: 'Show lines 1,001 to 1,200' }),
        );
        // The window is 701 to 1,200, so line 1,001 is row 300.
        expect(numberOf(document.activeElement as HTMLElement)).toBe(1001);
        expect(box().scrollTop).toBe(300 * ROW_PX);
      });
    });

    it('splits the text once, not on each move of the window', () => {
      const split = vi.spyOn(textLinesModule, 'textLines');
      const text = numbered(3000);
      const view = render(<YamlPane file="hello.yml" text={text} />);
      const calls = split.mock.calls.length;

      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 1,001 to 1,500' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      view.rerender(<YamlPane file="hello.yml" text={text} />);
      expect(split.mock.calls.length).toBe(calls);

      view.rerender(<YamlPane file="hello.yml" text={numbered(2999)} />);
      expect(split.mock.calls.length).toBe(calls + 1);
      split.mockRestore();
    });

    it('keeps the focus on the button while it remains', () => {
      render(<YamlPane file="hello.yml" text={numbered(3000)} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      expect(document.activeElement?.textContent).toBe(
        'Show lines 1,001 to 1,500',
      );
    });

    it('reaches the end of a file near the size limit, then moves the focus to the first new line', () => {
      const text = numbered(1200);
      const { container } = render(<YamlPane file="hello.yml" text={text} />);

      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 501 to 1,000' }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Show lines 1,001 to 1,200' }),
      );
      expect(numberOf(items().at(-1)!)).toBe(1200);
      expect(numberOf(items()[0]!)).toBe(701);
      expect(windowNotes(container)).toEqual(['Show lines 201 to 700']);
      expect(numberOf(document.activeElement as HTMLElement)).toBe(1001);
    });
  });
});
