// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { YAML_WINDOW_LINES } from './line-window';
import { BLOCK, FLOW, STAGES_FIRST, type SampleText } from './sample-texts';
import { YamlPane, type MarkedStage } from './YamlPane';

function renderPane(sample: SampleText, stage?: MarkedStage) {
  return render(<YamlPane file="hello.yml" text={sample.text} stage={stage} />);
}

function items(): HTMLElement[] {
  const region = screen.getByRole('region', { name: 'Lines of hello.yml' });
  return within(region).getAllByRole('listitem');
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
    const region = screen.getByRole('region', { name: 'Lines of hello.yml' });

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
    const region = screen.getByRole('region', { name: 'Lines of hello.yml' });

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
        `Lines ${(YAML_WINDOW_LINES + 1).toLocaleString('en-US')} to ${total.toLocaleString('en-US')} not shown.`,
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
        'Lines 1 to 1,250 not shown.',
        'Lines 1,751 to 3,000 not shown.',
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
      expect(windowNotes(container)).toEqual(['Lines 1 to 2,500 not shown.']);
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
        'Lines 1 to 99 not shown.',
        'Stage draft continues. Lines 600 to 3,000 not shown.',
      ]);
      expect(
        screen.getByText('Read-only. Lines 100 to 1,200 are stage draft.').id,
      ).toBe(
        screen
          .getByRole('region', { name: 'Lines of hello.yml' })
          .getAttribute('aria-describedby'),
      );
    });

    it('says a single line is not shown', () => {
      const { container } = render(
        <YamlPane file="hello.yml" text={numbered(YAML_WINDOW_LINES + 1)} />,
      );

      expect(windowNotes(container)).toEqual([
        `Line ${YAML_WINDOW_LINES + 1} not shown.`,
      ]);
    });
  });
});
