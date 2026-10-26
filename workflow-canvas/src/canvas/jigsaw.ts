// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties } from 'react';
import { NODE_WIDTH } from '../graph';
import { RADIUS } from '../theme/tokens';

// The run order ports are pieces of a jigsaw. The out port is a knob that
// hangs from the bottom edge of a node; the in port is a socket of the same
// shape cut into the top edge. This module is the one place that defines the
// shape: the node outline, the fills and the link handles all come from it.
//
// A piece is described in a frame whose origin is the middle of the piece on
// the line of the border, with y running into the socket (down the page).
// A knob below a node and a socket in the node under it both point down, so
// they are the same curve.

/** The width of the line around a node and a knob, in pixels. */
export const BORDER_WIDTH = 2;
/** The width of the head of the knob and of the socket. */
export const PORT_WIDTH = 22;
/** How far the centre of a port is from the right edge of a node. */
const PORT_INSET = 34;
/** The x of the centre of every port, in the frame of the node. */
export const PORT_X = NODE_WIDTH - PORT_INSET;
/** The empty space between the arrowhead and the mouth of a socket. */
const ARROW_GAP = 2;
/** The corner radius of a card. */
export const CARD_RADIUS = parseFloat(RADIUS.control);

const HEAD_RADIUS = PORT_WIDTH / 2;
const NECK_HALF = 3.5;
const FILLET = 3.5;
const NECK_STRAIGHT = 6;
/** How far the neck of a piece runs, from the opening to the head. */
export const NECK_LENGTH = FILLET + NECK_STRAIGHT;
// Half the width of the opening, where the border bends into the neck.
const MOUTH_HALF = NECK_HALF + FILLET;
const HEAD_CENTRE = NECK_LENGTH + Math.sqrt(HEAD_RADIUS ** 2 - NECK_HALF ** 2);

/** How far a knob reaches out of a node and a socket reaches into it. */
export const PORT_DEPTH = HEAD_CENTRE + HEAD_RADIUS;
/** The room the title of a node keeps clear, from the right edge, for a socket. */
export const PORT_CLEARANCE = PORT_INSET + HEAD_RADIUS + 8;

// A number as it is written in a path: two decimals at most.
const n = (value: number) => Number(value.toFixed(2));

// The curve of a piece, from one side of its opening to the other, drawn
// from the point (x - travel * MOUTH_HALF, y). `travel` is 1 for a left to
// right line and -1 for a right to left one. The neck is pinched and
// straight, and the head is an arc of a circle.
function curve(x: number, y: number, travel: 1 | -1): string {
  const neck = x - travel * NECK_HALF;
  const farNeck = x + travel * NECK_HALF;
  const sweep = travel === 1 ? 0 : 1;
  const base = y + FILLET;
  const head = y + NECK_LENGTH;
  return [
    `Q${n(neck)} ${n(y)} ${n(neck)} ${n(base)}`,
    `L${n(neck)} ${n(head)}`,
    `A${HEAD_RADIUS} ${HEAD_RADIUS} 0 1 ${sweep} ${n(farNeck)} ${n(head)}`,
    `L${n(farNeck)} ${n(base)}`,
    `Q${n(farNeck)} ${n(y)} ${n(x + travel * MOUTH_HALF)} ${n(y)}`,
  ].join('');
}

/**
 * The shape of a knob or a socket whose opening is on the line `y`, as a
 * path of its own, for filling. `travel` picks the side the path starts on.
 */
export function pieceShape(y: number, travel: 1 | -1 = 1): string {
  return `M${n(PORT_X - travel * MOUTH_HALF)} ${n(y)}${curve(PORT_X, y, travel)}`;
}

/** Where the letter of a piece sits, for a piece whose opening is on `y`. */
export function letterY(y: number): number {
  return n(y + HEAD_CENTRE);
}

export interface OutlineOptions {
  width: number;
  height: number;
  /** The corner radius. */
  radius: number;
  /** Whether a socket is cut into the top edge. */
  socket: boolean;
  /** Whether a knob hangs from the bottom edge. */
  knob: boolean;
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

/** The y of the border line along the top edge, and of the one along the bottom. */
export function borderLines(height: number) {
  return { top: BORDER_WIDTH / 2, bottom: height - BORDER_WIDTH / 2 };
}

/**
 * The outline of a node as one closed path, drawn clockwise from the top
 * left. The line runs through the middle of the border, and it bends in
 * around the socket and out around the knob, so the border has no break.
 */
export function nodeOutline(options: OutlineOptions): string {
  const { width, height, radius: r, socket, knob } = options;
  const { top, bottom } = borderLines(height);
  const left = BORDER_WIDTH / 2;
  const right = width - left;
  const side = (x: number, y: number) => `A${r} ${r} 0 0 1 ${n(x)} ${n(y)}`;

  return [
    `M${n(left + r)} ${n(top)}`,
    socket
      ? `L${n(PORT_X - MOUTH_HALF)} ${n(top)}${curve(PORT_X, top, 1)}`
      : '',
    `L${n(right - r)} ${n(top)}`,
    side(right, top + r),
    `L${n(right)} ${n(bottom - r)}`,
    side(right - r, bottom),
    knob
      ? `L${n(PORT_X + MOUTH_HALF)} ${n(bottom)}${curve(PORT_X, bottom, -1)}`
      : '',
    `L${n(left + r)} ${n(bottom)}`,
    side(left, bottom - r),
    `L${n(left)} ${n(top + r)}`,
    side(left + r, top),
    'Z',
  ].join('');
}

// The handle is the box that the link measures from: a link leaves the
// bottom of the out handle and arrives at the top of the in handle.
const HANDLE_BOX: CSSProperties = {
  left: PORT_X,
  right: 'auto',
  bottom: 'auto',
  width: PORT_WIDTH,
  height: PORT_DEPTH,
  transform: 'translateX(-50%)',
};

/** Puts the out handle on the tip of the knob, so the link starts there. */
export const OUT_HANDLE_STYLE: CSSProperties = { ...HANDLE_BOX, top: '100%' };

/**
 * Puts the in handle just above the mouth of the socket, so the arrowhead
 * stops there and never covers the socket.
 */
export const IN_HANDLE_STYLE: CSSProperties = {
  ...HANDLE_BOX,
  top: -ARROW_GAP,
};
