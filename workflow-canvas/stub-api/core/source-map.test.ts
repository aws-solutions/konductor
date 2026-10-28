// SPDX-License-Identifier: Apache-2.0
/** Checks line and column lookups, and that a long line costs no more per lookup. */
import { describe, expect, it } from 'vitest';
import { SourceMap } from './source-map.ts';
import { checkWorkflowText } from './validator.ts';

// CPU time, not wall time: a busy machine slows the clock but not the work.
const FLOW_CPU_LIMIT_MS = 2000;

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
  function flowMapping(count: number, prefix: string): string {
    const entries = Array.from(
      { length: count },
      (_, i) => `${prefix}k${i}: 1`,
    );
    return `{${entries.join(', ')}}\n`;
  }

  it.each([
    ['250 KB of ASCII', flowMapping(24_000, ''), 245_000],
    ['text with surrogate pairs', flowMapping(8000, '😀'), 100_000],
  ])('finishes well within the time limit for %s', (_, text, minBytes) => {
    const bytes = Buffer.byteLength(text);
    expect(bytes).toBeGreaterThan(minBytes);
    expect(bytes).toBeLessThanOrEqual(262_144);
    const started = process.cpuUsage();
    const result = checkWorkflowText(text, 'hello');
    const { user, system } = process.cpuUsage(started);
    expect(result.errors).toBeGreaterThan(7000);
    expect((user + system) / 1000).toBeLessThan(FLOW_CPU_LIMIT_MS);
  });
});
