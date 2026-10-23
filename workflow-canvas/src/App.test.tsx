// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the page title and the Designer and Execution tabs', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Workflow canvas' }),
    ).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Designer' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Execution' })).toBeTruthy();
  });
});
