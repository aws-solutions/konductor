// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isDevPageOrigin } from './dev-proxy.ts';

describe('isDevPageOrigin', () => {
  it.each([
    ['http://127.0.0.1:5173', 5173],
    ['http://localhost:5173', 5173],
    ['http://127.0.0.1:4173', 4173],
  ])('accepts %s on port %d', (origin, port) => {
    expect(isDevPageOrigin(origin, port)).toBe(true);
  });

  it.each([
    ['another port', 'http://localhost:3000', 5173],
    ['another host', 'http://evil.example:5173', 5173],
    ['https', 'https://localhost:5173', 5173],
    ['a suffix of the host', 'http://localhost:5173.evil.example', 5173],
    ['no Origin', undefined, 5173],
    ['an unknown local port', 'http://localhost:5173', undefined],
  ])('rejects %s', (_name, origin, port) => {
    expect(isDevPageOrigin(origin, port)).toBe(false);
  });
});
