// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { timestampMs } from './timestamp';

describe('timestampMs', () => {
  it.each([
    '1970-01-01T00:00:00Z',
    '2026-10-24T04:12:05Z',
    '2024-02-29T23:59:59Z',
    '2000-02-29T00:00:00Z',
    '2000-03-01T00:00:00Z',
    '2026-12-31T23:59:59Z',
    '1999-12-31T12:30:45Z',
  ])('reads %s as the platform does', (at) => {
    expect(timestampMs(at)).toBe(Date.parse(at));
  });

  it.each([
    '2026-10-24T04:12:05',
    '2026-10-24T04:12:05.000Z',
    '2026-10-24T04:12:05+00:00',
    '2026-10-24T06:12:05+02:00',
    '2026-02-29T00:00:00Z',
    '2024-02-30T00:00:00Z',
    '2026-02-31T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-10-00T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-10-24T24:00:00Z',
    'yesterday',
  ])('refuses %s', (at) => {
    expect(timestampMs(at)).toBeUndefined();
  });
});
