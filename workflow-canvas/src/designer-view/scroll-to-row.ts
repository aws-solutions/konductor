// SPDX-License-Identifier: Apache-2.0

/** The top and bottom of a box on screen, as `getBoundingClientRect` gives. */
export interface Edges {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The `scrollTop` of a box that puts `row` at its top (`'top'`) or at its
 * bottom (`'bottom'`), from where both are on screen now and the box's
 * current `scrollTop`. It is never below zero.
 */
export function scrollTopFor(
  box: Edges,
  row: Edges,
  scrollTop: number,
  at: 'top' | 'bottom',
): number {
  const shift = at === 'top' ? row.top - box.top : row.bottom - box.bottom;
  return Math.max(0, scrollTop + shift);
}
