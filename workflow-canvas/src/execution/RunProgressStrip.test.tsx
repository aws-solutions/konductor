// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RunProgress } from './core/run-progress';
import { RunProgressStrip } from './RunProgressStrip';

const RUNNING: RunProgress = {
  passed: 1,
  total: 4,
  running: 'review',
  elapsedMs: 65_000,
};

describe('RunProgressStrip', () => {
  it('says where the run is in a status region', () => {
    render(<RunProgressStrip progress={RUNNING} />);

    expect(screen.getByRole('status').textContent).toBe(
      'Running review. 1 of 4 stages passed.',
    );
  });

  it('shows the elapsed time outside the status region', () => {
    render(<RunProgressStrip progress={RUNNING} />);

    expect(screen.getByText('Elapsed 1:05')).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toContain('1:05');
  });

  it('draws the passed share of the stages in a bar hidden from a screen reader', () => {
    render(<RunProgressStrip progress={RUNNING} />);
    const passed = screen.getByTestId('run-progress-passed');

    expect(passed.style.width).toBe('25%');
    expect(passed.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('run-progress-blocked')).toBeNull();
  });

  it('draws the blocked stage after the passed ones and names it', () => {
    render(
      <RunProgressStrip
        progress={{
          passed: 1,
          total: 4,
          blocked: { name: 'review', reason: 'TIMEOUT' },
          outcome: 'halted',
          elapsedMs: 0,
        }}
      />,
    );

    expect(screen.getByTestId('run-progress-blocked').style.width).toBe('25%');
    expect(screen.getByRole('status').textContent).toBe(
      'Run halted at review. 1 of 4 stages passed.',
    );
  });

  it('draws an empty bar for a run with no stages', () => {
    render(
      <RunProgressStrip progress={{ passed: 0, total: 0, elapsedMs: 0 }} />,
    );

    expect(screen.getByTestId('run-progress-passed').style.width).toBe('0%');
  });
});
