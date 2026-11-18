// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BLOCK, FLOW, STAGES_FIRST, type SampleText } from './sample-texts';
import { YamlPane, type MarkedStage } from './YamlPane';

function renderPane(sample: SampleText, stage?: MarkedStage) {
  return render(<YamlPane file="hello.yml" text={sample.text} stage={stage} />);
}

function items(): HTMLElement[] {
  const region = screen.getByRole('region', { name: 'Lines of hello.yml' });
  return within(region).getAllByRole('listitem');
}

// The numbers of the lines that carry `aria-current`.
function marked(): number[] {
  return items()
    .map((item, index) => ({ item, n: index + 1 }))
    .filter(({ item }) => item.getAttribute('aria-current') === 'true')
    .map(({ n }) => n);
}

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
    expect(screen.getByText('Read-only.')).toBeTruthy();
  });

  it('marks a stage at the top of the file', () => {
    renderPane(STAGES_FIRST, stageOf(STAGES_FIRST, 'draft'));

    expect(marked()).toEqual([2, 3]);
    expect(items()).toHaveLength(8);
  });

  it('marks a stage in the middle of the file', () => {
    renderPane(BLOCK, stageOf(BLOCK, 'review'));

    expect(marked()).toEqual([10, 11]);
  });

  it('marks the stage at the end of the file', () => {
    renderPane(BLOCK, stageOf(BLOCK, 'wrap-up'));

    expect(marked()).toEqual([12, 13]);
    expect(items()).toHaveLength(13);
  });

  it('marks the one line of a stage in flow form', () => {
    renderPane(FLOW, stageOf(FLOW, 'review'));

    expect(marked()).toEqual([6]);
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
});
