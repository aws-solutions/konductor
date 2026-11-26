// SPDX-License-Identifier: Apache-2.0
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './states';

describe('workflow states', () => {
  it('lists the problems when the file has errors', () => {
    render(
      <EmptyState
        hasFile
        diagnostics={[
          {
            message: 'Missing key: intent',
            line: 2,
            path: '',
            severity: 'error',
          },
        ]}
      />,
    );

    expect(
      screen.getByText('The workflow file has errors, so it cannot be drawn.'),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole('list', { name: 'Problems in the workflow file' }),
      ).getByText('Line 2: Missing key: intent'),
    ).toBeTruthy();
  });

  it('shows the names in a problem as code, without backticks', () => {
    render(
      <EmptyState
        hasFile
        diagnostics={[
          {
            message: 'The mapping needs the key `intent`.',
            line: 2,
            path: '',
            severity: 'error',
          },
        ]}
      />,
    );

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(list.textContent).toBe('Line 2: The mapping needs the key intent.');
    expect(list.querySelector('code')?.textContent).toBe('intent');
  });

  it('shows the names in a load error as code, without backticks', () => {
    render(<ErrorState message="The key `stages` is missing." />);

    expect(screen.getByRole('alert').textContent).toContain(
      'The key stages is missing.',
    );
  });

  it('shows a problem that has no line without a line number', () => {
    render(
      <EmptyState
        hasFile
        diagnostics={[
          {
            message: 'The file is empty',
            line: undefined,
            path: '',
            severity: 'error',
          },
        ]}
      />,
    );

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(within(list).getByText('The file is empty')).toBeTruthy();
    expect(list.textContent).not.toContain('Line');
  });

  it('lists every problem when the server repeats an identical one', () => {
    const repeated = {
      message: 'Unknown key: owner',
      line: 3,
      path: 'owner',
      severity: 'error' as const,
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<EmptyState hasFile diagnostics={[repeated, repeated]} />);

    const list = screen.getByRole('list', {
      name: 'Problems in the workflow file',
    });
    expect(
      within(list).getAllByText('Line 3: Unknown key: owner'),
    ).toHaveLength(2);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('announces the loading state and the load error', () => {
    const { rerender } = render(<LoadingState />);
    expect(screen.getByRole('status').textContent).toContain('Loading');

    rerender(<ErrorState message="The launch code is not valid." />);

    expect(screen.getByRole('alert').textContent).toContain(
      'The launch code is not valid.',
    );
  });
});
