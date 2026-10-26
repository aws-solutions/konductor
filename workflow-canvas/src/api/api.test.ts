// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { canRetryStatus } from './api';

describe('canRetryStatus', () => {
  it.each([0, 500, 503])('retries status %i', (status) => {
    expect(canRetryStatus(status)).toBe(true);
  });

  it.each([401, 404, 499])('does not retry status %i', (status) => {
    expect(canRetryStatus(status)).toBe(false);
  });
});
