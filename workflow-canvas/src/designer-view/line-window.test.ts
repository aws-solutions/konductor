// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { lineWindow, YAML_WINDOW_LINES } from './line-window';

describe('lineWindow', () => {
  it('shows a text that fits whole', () => {
    expect(lineWindow(13, { line: 7, end_line: 9 }, 20)).toEqual({
      first: 1,
      last: 13,
    });
    expect(lineWindow(20, undefined, 20)).toEqual({ first: 1, last: 20 });
  });

  it('has an empty window for an empty text', () => {
    expect(lineWindow(0, undefined, 20)).toEqual({ first: 1, last: 0 });
  });

  it('starts at the top without a range', () => {
    expect(lineWindow(1000, undefined, 20)).toEqual({ first: 1, last: 20 });
  });

  it('centres the window on a range that fits', () => {
    expect(lineWindow(1000, { line: 500, end_line: 503 }, 20)).toEqual({
      first: 492,
      last: 511,
    });
  });

  it('keeps the window inside the text near its top and its end', () => {
    expect(lineWindow(1000, { line: 3, end_line: 4 }, 20)).toEqual({
      first: 1,
      last: 20,
    });
    expect(lineWindow(1000, { line: 995, end_line: 1000 }, 20)).toEqual({
      first: 981,
      last: 1000,
    });
  });

  it('starts at a range longer than the window and shows its first lines', () => {
    expect(lineWindow(1000, { line: 100, end_line: 400 }, 20)).toEqual({
      first: 100,
      last: 119,
    });
  });

  it('shows the first lines of a long range near the end', () => {
    expect(lineWindow(1000, { line: 990, end_line: 1000 }, 5)).toEqual({
      first: 990,
      last: 994,
    });
  });

  it(`shows at most ${YAML_WINDOW_LINES} lines by default`, () => {
    const { first, last } = lineWindow(262_144, undefined);

    expect(last - first + 1).toBe(YAML_WINDOW_LINES);
  });
});
