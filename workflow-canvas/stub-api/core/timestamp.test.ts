// SPDX-License-Identifier: Apache-2.0
/** Checks the date arithmetic of the core against the platform's `Date`. */
import { describe, expect, it } from 'vitest';
import { formatTimestamp, runIdPrefix } from './timestamp.ts';

const DAY_MS = 86_400_000;
// Leap days, the end of a century that is not a leap year, and year ends.
const EDGES = [
  '1970-01-01T00:00:00Z',
  '2000-02-29T23:59:59Z',
  '2024-02-29T12:00:00Z',
  '2100-02-28T23:59:59Z',
  '2100-03-01T00:00:00Z',
  '2026-12-31T23:59:59Z',
  '2027-01-01T00:00:00Z',
];

describe('formatTimestamp', () => {
  it.each(EDGES)('formats %s', (iso) => {
    expect(formatTimestamp(Date.parse(iso))).toBe(iso);
  });

  it('agrees with Date over 200 years, a step of an odd length at a time', () => {
    const step = 37 * DAY_MS + 13 * 3_600_000 + 7_001;
    for (let ms = 0; ms < 200 * 366 * DAY_MS; ms += step) {
      const expected = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
      expect(formatTimestamp(ms)).toBe(expected);
    }
  });

  it('drops the milliseconds', () => {
    expect(formatTimestamp(Date.parse('2026-10-24T19:14:28.999Z'))).toBe(
      '2026-10-24T19:14:28Z',
    );
  });
});

describe('runIdPrefix', () => {
  it('is the date and the minute', () => {
    expect(runIdPrefix(Date.parse('2026-10-24T04:12:59Z'))).toBe(
      '20261024-0412',
    );
  });
});
