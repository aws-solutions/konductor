// SPDX-License-Identifier: Apache-2.0
import type { LineRange } from '../code-pane/CodeLines';

/**
 * The most lines the YAML pane mounts at once. A file may have up to 262,144
 * bytes, so up to that many lines, and every line is a row in the page.
 */
export const YAML_WINDOW_LINES = 500;

/** The lines to show, from `first` to `last`, both included, counted from 1. */
export interface LineWindow {
  readonly first: number;
  readonly last: number;
}

/**
 * The window of at most `size` of the `total` lines of a text. It holds the
 * whole of `range` when the range fits, centred on it, and the first `size`
 * lines of the range when it does not. Without a range it starts at line 1.
 * An empty text has the empty window from 1 to 0.
 */
export function lineWindow(
  total: number,
  range: LineRange | undefined,
  size: number = YAML_WINDOW_LINES,
): LineWindow {
  if (total <= size) return { first: 1, last: total };
  const highestFirst = total - size + 1;
  const first = range ? centredFirst(range, size) : 1;
  const clamped = Math.min(Math.max(first, 1), highestFirst);
  return { first: clamped, last: clamped + size - 1 };
}

function centredFirst(range: LineRange, size: number): number {
  const length = range.end_line - range.line + 1;
  if (length >= size) return range.line;
  return range.line - Math.floor((size - length) / 2);
}
