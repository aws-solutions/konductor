// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { stopMarkLabel } from './stop-mark';

describe('stopMarkLabel', () => {
  it.each([
    ['passed', 'The run ends after review: passed'],
    ['blocked', 'The run ends after review: blocked'],
    ['not-reached', 'The run ends after review: not reached'],
  ] as const)('says a %s mark as "%s"', (state, label) => {
    expect(stopMarkLabel('review', state)).toBe(label);
  });

  it('names the mark only while the run may still reach the stage', () => {
    expect(stopMarkLabel('review', undefined)).toBe(
      'The run ends after review',
    );
  });
});
