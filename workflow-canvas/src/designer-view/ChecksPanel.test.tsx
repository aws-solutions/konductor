// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { DraftCheck } from '../designer/core/draft';
import { ChecksPanel } from './ChecksPanel';

const CHECKS: DraftCheck[] = [
  { key: 'c1', id: 'exists', kind: 'file', file: 'PLAN.md', run: [] },
  { key: 'c2', id: 'tests', kind: 'run', file: '', run: ['npm', 'test'] },
];

function describedText(input: HTMLElement): string {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');
}

function Harness({ initial = CHECKS }: { initial?: readonly DraftCheck[] }) {
  const [checks, setChecks] = useState(initial);
  return (
    <ChecksPanel
      checks={checks}
      onChange={(key, check) =>
        setChecks((rows) =>
          rows.map((row) => (row.key === key ? { key, ...check } : row)),
        )
      }
      onAdd={() =>
        setChecks((rows) => [
          ...rows,
          {
            key: `c${rows.length + 1}`,
            id: `check-${rows.length + 1}`,
            kind: 'file',
            file: '',
            run: [],
          },
        ])
      }
      onRemove={(key) =>
        setChecks((rows) => rows.filter((row) => row.key !== key))
      }
    />
  );
}

describe('ChecksPanel validation', () => {
  it('associates id, file and run errors with their fields', () => {
    render(
      <ChecksPanel
        checks={[
          { ...CHECKS[0]!, id: 'Bad Id', file: '../outside' },
          { ...CHECKS[1]!, id: 'Bad Id', run: [] },
        ]}
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    const id = screen.getByRole('textbox', { name: 'Check id 1' });
    const file = screen.getByRole('textbox', { name: 'Check file 1' });
    const run = screen.getByRole('textbox', { name: /^run$/ });
    for (const input of [id, file, run]) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(describedText(input)).not.toBe('');
    }
  });

  it('marks every duplicate id field', () => {
    render(
      <ChecksPanel
        checks={[CHECKS[0]!, { ...CHECKS[1]!, id: 'exists' }]}
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    for (const input of screen.getAllByRole('textbox', { name: /Check id/ })) {
      expect(describedText(input)).toContain('Check ids must be unique.');
    }
  });

  it('keeps typed values visible while controls are disabled', () => {
    render(
      <ChecksPanel
        checks={[{ ...CHECKS[0]!, id: 'typed', file: 'TYPED.md' }]}
        disabled
        disabledReason="Save the YAML edit first."
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(
      (screen.getByRole('textbox', { name: 'Check id 1' }) as HTMLInputElement)
        .value,
    ).toBe('typed');
    expect(
      (screen.getByRole('textbox', { name: 'Check id 1' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it('allows scalar edits while structural controls are blocked', () => {
    render(
      <ChecksPanel
        checks={CHECKS}
        structuralDisabled
        structuralDisabledReason="Comments must stay in place."
        onChange={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(
      (screen.getByRole('textbox', { name: 'Check id 1' }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: 'Add check' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe('ChecksPanel focus', () => {
  it('focuses the new id after Add', async () => {
    render(<Harness initial={[CHECKS[0]!]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Check id 2' }),
      ),
    );
  });

  it('focuses an adjacent id after removal', async () => {
    render(<Harness />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove check' })[1]!,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Check id 1' }),
      ),
    );
  });

  it('focuses Add after removing the last check', async () => {
    render(<Harness initial={[CHECKS[0]!]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove check' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Add check' }),
      ),
    );
  });
});
