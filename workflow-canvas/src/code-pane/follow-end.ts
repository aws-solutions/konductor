// SPDX-License-Identifier: Apache-2.0

/**
 * How close to the bottom, in pixels, a box still counts as at the bottom.
 * It absorbs rounding of fractional scroll positions.
 */
export const AT_END_PX = 4;

/** The scroll measures of a box, as the DOM gives them. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Whether the box shows its last line, so new lines should keep it there.
 * A box that does not scroll is at its end.
 */
export function isAtEnd(box: ScrollBox): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop <= AT_END_PX;
}

/** The `scrollTop` that shows the last line of the box. */
export function endScrollTop(box: ScrollBox): number {
  return Math.max(0, box.scrollHeight - box.clientHeight);
}
