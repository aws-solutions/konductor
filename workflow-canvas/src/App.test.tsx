// SPDX-License-Identifier: Apache-2.0
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the page title inside a main landmark', () => {
    render(<App />);

    const main = screen.getByRole('main');
    expect(main.querySelector('h1')?.textContent).toBe('Workflow canvas');
  });

  it('renders the Designer and Execution tabs with Designer selected', () => {
    render(<App />);

    expect(
      screen
        .getByRole('tab', { name: 'Designer' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen
        .getByRole('tab', { name: 'Execution' })
        .getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('shows a placeholder when each tab is selected', () => {
    render(<App />);

    for (const name of ['Designer', 'Execution']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(screen.getByRole('tabpanel', { name }).textContent).toContain(
        'Nothing here yet.',
      );
    }
  });
});
