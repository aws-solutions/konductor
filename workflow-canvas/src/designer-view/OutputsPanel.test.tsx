// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OUTPUT_NAME_ERROR } from '../designer/core/outputs-text';
import { OutputsPanel } from './OutputsPanel';

const OUTPUTS = [
  { id: 'o1', name: 'design', path: 'DESIGN.md' },
  { id: 'o2', name: 'notes', path: 'NOTES.md' },
];

function describedText(input: HTMLElement): string {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
}

function Harness({ initial = OUTPUTS }: { initial?: typeof OUTPUTS }) {
  const [outputs, setOutputs] = useState(initial);
  return (
    <OutputsPanel
      outputs={outputs}
      onChange={(id, change) =>
        setOutputs((rows) =>
          rows.map((row) => (row.id === id ? { ...row, ...change } : row)),
        )
      }
      onAdd={() =>
        setOutputs((rows) => [
          ...rows,
          { id: `o${rows.length + 1}`, name: '', path: '' },
        ])
      }
      onRemove={(id) =>
        setOutputs((rows) => rows.filter((row) => row.id !== id))
      }
    />
  );
}

describe('OutputsPanel validation', () => {
  it('groups rows under an Outputs heading', () => {
    render(<Harness />);
    expect(screen.getByText('Outputs')).toBeDefined();
  });

  it('associates pattern, duplicate and path errors with their fields', () => {
    const { rerender } = render(
      <OutputsPanel
        outputs={[{ ...OUTPUTS[0]!, name: 'Bad_Name', path: '../outside' }]}
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    const name = screen.getByRole('textbox', { name: 'Output name 1' });
    const path = screen.getByRole('textbox', { name: 'Output path 1' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(name)).toContain(OUTPUT_NAME_ERROR);
    expect(path.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(path)).toContain('Use a relative path');

    rerender(
      <OutputsPanel
        outputs={[OUTPUTS[0]!, { ...OUTPUTS[1]!, name: 'design' }]}
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    for (const input of screen.getAllByRole('textbox', {
      name: /Output name/,
    })) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(describedText(input)).toContain('Output names must be unique');
    }
  });

  it('keeps scalar fields enabled when structural edits are blocked', () => {
    render(
      <OutputsPanel
        outputs={OUTPUTS}
        structuralDisabled
        structuralDisabledReason="Comments must stay in place."
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Output name 1',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: 'Add output' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe('OutputsPanel focus', () => {
  it('moves focus to the name of a newly added row', async () => {
    render(<Harness initial={[OUTPUTS[0]!]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add output' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Output name 2' }),
      ),
    );
  });

  it('moves focus to the adjacent row after removal', async () => {
    render(<Harness />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove output' })[1]!,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Output name 1' }),
      ),
    );
  });

  it('moves focus to Add output after the last row is removed', async () => {
    render(<Harness initial={[OUTPUTS[0]!]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove output' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Add output' }),
      ),
    );
  });
});

describe('OutputsPanel callbacks', () => {
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
