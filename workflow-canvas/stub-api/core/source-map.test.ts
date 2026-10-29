// SPDX-License-Identifier: Apache-2.0
/** Checks line and column lookups, and that a long line costs no more per lookup. */
import { describe, expect, it, vi } from 'vitest';
import { countingText } from '../test-support/counting-text.ts';
import {
  countTableReads,
  withCountedUint32Arrays,
} from '../test-support/counting-tables.ts';
import { SourceMap } from './source-map.ts';
import { checkWorkflowText } from './validator.ts';

describe('SourceMap', () => {
  it('counts lines from 1 at LF, CRLF and a lone CR', () => {
    const map = new SourceMap('a\nb\r\nc\rd');
    expect([0, 2, 5, 7].map((at) => map.position(at))).toEqual([
      { line: 1, column: 1 },
      { line: 2, column: 1 },
      { line: 3, column: 1 },
      { line: 4, column: 1 },
    ]);
  });

  it('counts code points, so a pair of UTF-16 units is one column', () => {
    const map = new SourceMap('a😀b\n😀😀c');
    expect(map.position(3)).toEqual({ line: 1, column: 3 });
    expect(map.position(4)).toEqual({ line: 1, column: 4 });
    expect(map.position(9)).toEqual({ line: 2, column: 3 });
  });

  it('counts a tab as one column', () => {
    expect(new SourceMap('\t\tx').position(2)).toEqual({ line: 1, column: 3 });
  });

  it('puts an offset at the end of the text on the last line', () => {
    expect(new SourceMap('ab\n').position(3)).toEqual({ line: 2, column: 1 });
  });
});

const CONTRACT_LIMIT_BYTES = 262_144;

describe('the check of a very long line', () => {
  // One flow mapping of unknown keys on one line. The contract allows 262144
  // bytes, and the quadratic version of the lookup needed over a minute here.
  // The cost is counted in operations, never in time, so load cannot fail it.
  function flowMapping(count: number, prefix: string): string {
    const entries = Array.from(
      { length: count },
      (_, i) => `${prefix}k${i}: 1`,
    );
    return `{${entries.join(', ')}}\n`;
  }

  function lookupsOf(text: string): { lookups: number; errors: number } {
    const position = vi.spyOn(SourceMap.prototype, 'position');
    try {
      const { errors } = checkWorkflowText(text, 'hello');
      return { lookups: position.mock.calls.length, errors };
    } finally {
      position.mockRestore();
    }
  }

  it.each([
    ['ASCII', ''],
    ['surrogate pairs', '😀'],
  ])('reads each character a fixed number of times, for %s', (_, prefix) => {
    const small = countingText(flowMapping(1000, prefix));
    const large = countingText(flowMapping(4000, prefix));

    new SourceMap(small.wrapped);
    new SourceMap(large.wrapped);

    const lengthRatio = large.wrapped.length / small.wrapped.length;
    expect(large.counted.reads / small.counted.reads).toBeCloseTo(
      lengthRatio,
      1,
    );
  });

  it('reads none of the text to find a position on a long line', () => {
    const { counted, wrapped } = countingText(flowMapping(24_000, ''));
    const map = new SourceMap(wrapped);
    const readsToBuild = counted.reads;

    for (let at = 0; at < wrapped.length; at += 9973) map.position(at);

    expect(counted.reads).toBe(readsToBuild);
  });

  it('looks up a number of positions that grows in step with the text', () => {
    const small = lookupsOf(flowMapping(1000, ''));
    const large = lookupsOf(flowMapping(4000, ''));

    expect(small.errors).toBeGreaterThan(900);
    expect(large.errors / small.errors).toBeCloseTo(4, 0);
    expect(large.lookups / small.lookups).toBeCloseTo(4, 0);
  });

  // The text is never read here, so only the tables are counted: the offset
  // table and the line starts, whatever they are made of. A lookup that walks
  // either grows with the text and fails at the contract's size limit.
  const LOOKUPS = 20;

  function offsetsOf(length: number): number[] {
    return Array.from({ length: LOOKUPS }, (_, i) =>
      Math.floor((i * length) / LOOKUPS),
    );
  }

  function readsPerLookup(text: string): number {
    const map = new SourceMap(text);
    const counter = countTableReads(map);
    for (const at of offsetsOf(text.length)) map.position(at);
    return counter.reads / LOOKUPS;
  }

  it.each([65_536, CONTRACT_LIMIT_BYTES])(
    'reads a fixed number of table entries per lookup on one line of %i characters',
    (length) => {
      expect(readsPerLookup('a'.repeat(length))).toBeLessThanOrEqual(4);
    },
  );

  it('reads a number of entries that grows with the log of the lines, on the most lines the contract allows', () => {
    const lines = CONTRACT_LIMIT_BYTES / 2;
    const perLookup = readsPerLookup('a\n'.repeat(lines));

    expect(perLookup).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(lines)) + 4);
  });

  it('builds its tables in a number of reads that grows in step with the text', () => {
    const reads = (length: number) =>
      withCountedUint32Arrays((counter) => {
        new SourceMap('a'.repeat(length));
        return counter.reads;
      });

    expect(reads(CONTRACT_LIMIT_BYTES)).toBeLessThanOrEqual(
      2 * CONTRACT_LIMIT_BYTES,
    );
  });

  // Smaller than the contract's limit: the counts above show the cost is
  // linear, and the full 250 KB takes longer than a loaded machine allows.
  it.each([
    ['ASCII', flowMapping(8000, ''), 60_000],
    ['surrogate pairs', flowMapping(3000, '😀'), 40_000],
  ])('checks a long line of %s', (_, text, minBytes) => {
    expect(Buffer.byteLength(text)).toBeGreaterThan(minBytes);
    expect(checkWorkflowText(text, 'hello').errors).toBeGreaterThan(2500);
  });
});
