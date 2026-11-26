// SPDX-License-Identifier: Apache-2.0
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NextRunAnnouncements } from './NextRunAnnouncements';

const sentenceOf = (code: string) =>
  code === 'RESULT_MISSING'
    ? 'The final message of the session has no result line.'
    : undefined;

describe('NextRunAnnouncements', () => {
  it.each([
    [
      'a known reason',
      'RESULT_MISSING',
      'Run halted at draft. 0 of 2 stages passed. The final message of the session has no result line.',
    ],
    [
      'an unknown reason',
      'LATER_REASON',
      'Run halted at draft. 0 of 2 stages passed. LATER_REASON',
    ],
  ])('ends a halted run announcement with %s', (_, reason, expected) => {
    render(
      <NextRunAnnouncements
        run={{
          active: false,
          status: 'Run halted at draft. 0 of 2 stages passed.',
          reason,
        }}
        reasonSentence={sentenceOf}
      />,
    );

    expect(screen.getByTestId('run-live-status').textContent).toBe(expected);
  });
});
