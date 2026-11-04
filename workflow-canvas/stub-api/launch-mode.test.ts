// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { reusableLaunchCode } from './launch-mode.ts';

describe('reusableLaunchCode', () => {
  it('is on for a stub that runs beside the dev server', () => {
    expect(reusableLaunchCode(['--with-dev-server'], {})).toBe(true);
  });

  it('is off for a stub that follows the contract on its own', () => {
    expect(reusableLaunchCode([], {})).toBe(false);
  });

  it('is off beside the dev server when STUB_STRICT=1 asks for the contract', () => {
    expect(
      reusableLaunchCode(['--with-dev-server'], { STUB_STRICT: '1' }),
    ).toBe(false);
  });

  it.each(['', '0', 'false'])('stays on for STUB_STRICT=%j', (value) => {
    expect(
      reusableLaunchCode(['--with-dev-server'], { STUB_STRICT: value }),
    ).toBe(true);
  });
});
