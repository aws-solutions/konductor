// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties } from 'react';
import { NODE_WIDTH } from '../graph';
import { RADIUS } from '../theme/tokens';

// The run order ports are pieces of a jigsaw. The out port is a square tab
// that hangs from the bottom edge of a node; the in port is a notch of the
// same outline in the top edge, in line with it, so a tab fits the notch of
// the node under it. This module is the one place that defines the shape:
// the node outline, the fills and the link handles all come from it.
//
// A port is drawn in a box of PORT_WIDTH by PORT_HEIGHT. The outline is a
// stem that crosses the border and a wider body below it, both pointing
// down the page, for the tab and for the notch.

/** The width of the line around a node, in pixels. */
export const BORDER_WIDTH = 2;
/** The width of the box of a port. */
export const PORT_WIDTH = 26;
/** The height of the box of a port: its stem and its body. */
export const PORT_HEIGHT = 16;
/** The x of the centre of every port, in the frame of the node. */
export const PORT_X = NODE_WIDTH / 2;
/** The corner radius of a card. */
export const CARD_RADIUS = parseFloat(RADIUS.control);

/** The width of the dark rim around a tab and a notch. */
export const RIM_WIDTH = 3.6;
/** The width of the coloured ring around the white inside of a notch. */
export const RING_WIDTH = 2.4;

/** The outline of a port in its box: the stem, then the body. */
const OUTLINE = 'M9.5 0V4H7V16H19V4H16.5V0';
/** The closed outline, for filling. */
export const PORT_SHAPE = `${OUTLINE}Z`;
/** The open outline of a notch, which has no line along its mouth. */
export const NOTCH_RING = OUTLINE;
/** The y of the letter in a port, in its box: in the middle of the body. */
export const LETTER_Y = 10;

/** The y of the top of the box of a notch, in the frame of the node. */
export const NOTCH_TOP = BORDER_WIDTH;
/** The y of the top of the box of a tab, in the frame of a node `height` tall. */
export function tabTop(height: number): number {
  return height - BORDER_WIDTH;
}

/** The transform that puts the box of a port at `top`, centred on PORT_X. */
export function portTransform(top: number): string {
  return `translate(${PORT_X - PORT_WIDTH / 2} ${top})`;
}

// A number as it is written in a path: two decimals at most.
const n = (value: number) => Number(value.toFixed(2));

export interface OutlineOptions {
  width: number;
  height: number;
  /** The corner radius. */
  radius: number;
}

/** The clear space between a focused node and its focus ring. */
export const FOCUS_GAP = 2;
/** The thickness of the focus ring. */
export const FOCUS_WIDTH = 3;

/**
 * The stroke width that makes the outline of a node grow by `spread` pixels
 * on each side of its border, as the focus ring and its gap do.
 */
export function spreadStroke(spread: number): number {
  return BORDER_WIDTH + 2 * spread;
}

/**
 * The stroke width that makes the outline of a tab grow by `spread` pixels
 * beyond its dark rim.
 */
export function rimSpreadStroke(spread: number): number {
  return RIM_WIDTH + 2 * spread;
}

/** The y of the border line along the top edge, and of the one along the bottom. */
export function borderLines(height: number) {
  return { top: BORDER_WIDTH / 2, bottom: height - BORDER_WIDTH / 2 };
}

/**
 * The outline of a node as one closed rounded rectangle, drawn clockwise
 * from the top left. The line runs through the middle of the border.
 */
export function nodeOutline(options: OutlineOptions): string {
  const { width, height, radius: r } = options;
  const { top, bottom } = borderLines(height);
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

// The handle is the box that the link measures from: a link leaves the
// bottom of the out handle, which is the tip of the tab, and arrives at the
// top of the in handle, which is the top of the notch.
const HANDLE_BOX: CSSProperties = {
  left: PORT_X,
  right: 'auto',
  bottom: 'auto',
  width: PORT_WIDTH,
  height: PORT_HEIGHT,
  transform: 'translateX(-50%)',
};

/** Puts the out handle on the tab, so the link starts at its tip. */
export const OUT_HANDLE_STYLE: CSSProperties = {
  ...HANDLE_BOX,
  top: `calc(100% - ${BORDER_WIDTH}px)`,
};

/** Puts the in handle on the notch, so the arrowhead stops at its top. */
export const IN_HANDLE_STYLE: CSSProperties = {
  ...HANDLE_BOX,
  top: NOTCH_TOP,
};
