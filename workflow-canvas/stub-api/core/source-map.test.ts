// SPDX-License-Identifier: Apache-2.0
/** Checks line and column lookups, and that a long line costs no more per lookup. */
import { describe, expect, it, vi } from 'vitest';
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

  /** A string that counts the characters read from it. */
  function countingText(text: string) {
    const counted = { reads: 0 };
    const wrapped = new String(text) as unknown as string;
    Object.defineProperty(wrapped, 'charCodeAt', {
      value: (index: number) => {
        counted.reads++;
        return text.charCodeAt(index);
      },
    });
    return { counted, wrapped };
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

  it('reads no character of the text to find a position on a long line', () => {
    const { counted, wrapped } = countingText(flowMapping(24_000, ''));
    const map = new SourceMap(wrapped);
    const readsToBuild = counted.reads;

    for (let at = 0; at < wrapped.length; at += 997) map.position(at);

    expect(counted.reads).toBe(readsToBuild);
  });

  it('looks up a number of positions that grows in step with the text', () => {
    const small = lookupsOf(flowMapping(1000, ''));
    const large = lookupsOf(flowMapping(4000, ''));

    expect(small.errors).toBeGreaterThan(900);
    expect(large.errors / small.errors).toBeCloseTo(4, 0);
    expect(large.lookups / small.lookups).toBeCloseTo(4, 0);
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
