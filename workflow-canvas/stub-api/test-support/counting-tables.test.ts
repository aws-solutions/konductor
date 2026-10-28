// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { withCountedUint32Arrays } from './counting-tables.ts';

describe('withCountedUint32Arrays', () => {
  it('counts index reads and not writes or length', () => {
    const reads = withCountedUint32Arrays((counter) => {
      const table = new Uint32Array(8);
      table[0] = 5;
      void table.length;
      void table[0];
      void table[1];
      return counter.reads;
    });
    expect(reads).toBe(2);
  });

  it('puts the real constructor back, even when the run throws', () => {
    const Real = Uint32Array;
    expect(() =>
      withCountedUint32Arrays(() => {
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(Uint32Array).toBe(Real);
  });
});
