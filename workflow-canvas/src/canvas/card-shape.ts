// SPDX-License-Identifier: Apache-2.0
import { RADIUS } from '../theme/tokens';

/** The width of the line around a node, in pixels. */
export const BORDER_WIDTH = 2;
/** The corner radius of a card. */
export const CARD_RADIUS = parseFloat(RADIUS.control);

/** The clear space between a focused node and its focus ring. */
export const FOCUS_GAP = 2;
/** The thickness of the focus ring. */
export const FOCUS_WIDTH = 3;

/**
 * The size of a run order port: a dot on the middle of the top edge where run
 * order arrives, and one on the bottom edge where it leaves. `canvas.css`
 * draws it at this size.
 */
export const PORT_DOT_SIZE = 10;

// A number as it is written in a path: two decimals at most.
const n = (value: number) => Number(value.toFixed(2));

export interface OutlineOptions {
  width: number;
  height: number;
  /** The corner radius. */
  radius: number;
}

/**
 * The stroke width that makes the outline of a node grow by `spread` pixels
 * on each side of its border, as the focus ring and its gap do.
 */
export function spreadStroke(spread: number): number {
  return BORDER_WIDTH + 2 * spread;
}

/**
 * The outline of a node as one closed rounded rectangle, drawn clockwise
 * from the top left. The line runs through the middle of the border.
 */
export function nodeOutline(options: OutlineOptions): string {
  const { width, height, radius: r } = options;
  const top = BORDER_WIDTH / 2;
  const bottom = height - BORDER_WIDTH / 2;
  const left = BORDER_WIDTH / 2;
  const right = width - left;
  const side = (x: number, y: number) => `A${r} ${r} 0 0 1 ${n(x)} ${n(y)}`;

  return [
    `M${n(left + r)} ${n(top)}`,
    `L${n(right - r)} ${n(top)}`,
    side(right, top + r),
    `L${n(right)} ${n(bottom - r)}`,
    side(right - r, bottom),
    `L${n(left + r)} ${n(bottom)}`,
    side(left, bottom - r),
    `L${n(left)} ${n(top + r)}`,
    side(left + r, top),
    'Z',
  ].join('');
}
