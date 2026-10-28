// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { countTableReads, withCountedUint32Arrays } from './counting-tables.ts';

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

describe('countTableReads', () => {
  it('counts index reads on arrays and typed arrays, whatever their names', () => {
    const owner = { starts: [1, 2, 3], sums: new Uint32Array(4), name: 'x' };
    const counter = countTableReads(owner);

    void owner.starts[0];
    void owner.sums[1];
    void owner.sums[2];
    void owner.starts.length;

    expect(counter.reads).toBe(3);
  });

  it('charges a method call the length of the table', () => {
    const owner = { starts: [1, 2, 3, 4, 5] };
    const counter = countTableReads(owner);

    owner.starts.indexOf(4);

    expect(counter.reads).toBe(5);
  });

  it('leaves values and other properties as they were', () => {
    const owner = { starts: [7, 8], name: 'x' };
    countTableReads(owner);

    expect(owner.starts[1]).toBe(8);
    expect(owner.starts.length).toBe(2);
    expect(owner.name).toBe('x');
  });
});
