// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OUTPUT_NAME_ERROR } from '../designer/core/outputs-text';
import { OutputsPanel } from './OutputsPanel';

const OUTPUTS = [
  { id: 'o1', name: 'design', path: 'DESIGN.md' },
  { id: 'o2', name: 'notes', path: 'NOTES.md' },
];

describe('OutputsPanel', () => {
  it('reports invalid and duplicate names through their form fields', () => {
    const { rerender } = render(
      <OutputsPanel
        outputs={[{ ...OUTPUTS[0]!, name: 'Bad_Name' }]}
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    const invalid = screen.getByRole('textbox', {
      name: 'Output name 1',
    });
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain(OUTPUT_NAME_ERROR);

    rerender(
      <OutputsPanel
        outputs={[OUTPUTS[0]!, { ...OUTPUTS[1]!, name: 'design' }]}
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(document.body.textContent).toContain('Output names must be unique');
  });

  it('reports row edits, additions and removals', () => {
    const onChange = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <OutputsPanel
        outputs={OUTPUTS}
        onChange={onChange}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Output path 1' }), {
      target: { value: 'docs/DESIGN.md' },
    });
    expect(onChange).toHaveBeenCalledWith('o1', {
      name: 'design',
      path: 'docs/DESIGN.md',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add output' }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove output' })[1]!,
    );
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith('o2');
  });
});
