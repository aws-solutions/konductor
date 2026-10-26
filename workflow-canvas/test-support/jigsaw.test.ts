// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH } from '../src/graph';
import {
  BORDER_WIDTH,
  CARD_RADIUS,
  FOCUS_GAP,
  FOCUS_WIDTH,
  IN_HANDLE_STYLE,
  NECK_LENGTH,
  OUT_HANDLE_STYLE,
  PORT_DEPTH,
  PORT_WIDTH,
  PORT_X,
  letterY,
  nodeOutline,
  pieceShape,
  spreadStroke,
} from '../src/canvas/jigsaw.ts';

const SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT.stage, radius: 10 };
const count = (path: string, command: string) => path.split(command).length - 1;
// The arcs that are heads of knobs and sockets, not corners.
const heads = (path: string) => count(path, `A${PORT_WIDTH / 2} `);

describe('the shape of a port', () => {
  it('is a round head 22 to 26 pixels wide on a narrow neck', () => {
    expect(PORT_WIDTH).toBeGreaterThanOrEqual(22);
    expect(PORT_WIDTH).toBeLessThanOrEqual(26);
    // The opening of the piece is narrower than its head.
    const opening = pieceShape(0).match(/^M([\d.]+) /)?.[1];
    expect(Math.abs(Number(opening) - PORT_X) * 2).toBeLessThan(PORT_WIDTH);
    expect(PORT_DEPTH).toBeGreaterThan(PORT_WIDTH);
  });

  it('has a neck long enough to read as a jigsaw tab, with a straight run', () => {
    // The neck is 9.5 pixels, and 8 or more of it shows between the opening
    // and the top of the head.
    expect(NECK_LENGTH).toBeGreaterThanOrEqual(8);
    expect(PORT_DEPTH - PORT_WIDTH).toBeGreaterThanOrEqual(8);
    // The neck runs straight down for part of its length: a vertical line.
    expect(pieceShape(0)).toMatch(/L[\d.]+ [\d.]+A/);
  });

  it('is one curve for the knob and the socket, drawn from either side', () => {
    const [ltr, rtl] = [pieceShape(5, 1), pieceShape(5, -1)];

    expect(heads(ltr)).toBe(1);
    expect(heads(rtl)).toBe(1);
    // Each starts where the other ends.
    expect(ltr.match(/^M([\d.]+) 5/)?.[1]).toBe(rtl.match(/ ([\d.]+) 5$/)?.[1]);
    expect(rtl.match(/^M([\d.]+) 5/)?.[1]).toBe(ltr.match(/ ([\d.]+) 5$/)?.[1]);
  });

  it('puts the letter in the middle of the head', () => {
    expect(letterY(1)).toBeGreaterThan(1);
    expect(letterY(1)).toBeLessThan(1 + PORT_DEPTH);
  });

  it('keeps clear of the rounded corner and fits in the shortest node', () => {
    expect(PORT_X + PORT_WIDTH / 2).toBeLessThanOrEqual(
      NODE_WIDTH - CARD_RADIUS - BORDER_WIDTH,
    );
    expect(PORT_DEPTH).toBeLessThan(NODE_HEIGHT.end / 2 + PORT_WIDTH / 2);
  });
});

describe('nodeOutline', () => {
  it('is one closed path', () => {
    for (const [socket, knob] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const) {
      const path = nodeOutline({ ...SIZE, socket, knob });

      expect(count(path, 'M')).toBe(1);
      expect(path.endsWith('Z')).toBe(true);
    }
  });

  it('bends in around a socket and out around a knob, and only then', () => {
    expect(heads(nodeOutline({ ...SIZE, socket: false, knob: false }))).toBe(0);
    expect(heads(nodeOutline({ ...SIZE, socket: true, knob: false }))).toBe(1);
    expect(heads(nodeOutline({ ...SIZE, socket: false, knob: true }))).toBe(1);
    expect(heads(nodeOutline({ ...SIZE, socket: true, knob: true }))).toBe(2);
  });

  it('puts the socket on the top edge and the knob on the bottom edge at one x', () => {
    const path = nodeOutline({ ...SIZE, socket: true, knob: true });
    const half = BORDER_WIDTH / 2;
    const bottom = SIZE.height - half;
    const [start] = pieceShape(half).match(/^M[\d.]+ [\d.]+/) ?? [];
    const [knobStart] = pieceShape(bottom, -1).match(/^M[\d.]+ [\d.]+/) ?? [];

    expect(path).toContain(`L${start?.slice(1)}`);
    expect(path).toContain(`L${knobStart?.slice(1)}`);
  });

  it('is a plain rounded card when there are no ports', () => {
    const path = nodeOutline({ ...SIZE, socket: false, knob: false });

    expect(path).not.toContain('Q');
    expect(count(path, 'A')).toBe(4);
  });
});

describe('the focus ring', () => {
  it('grows the outline by the gap and by the gap plus the ring', () => {
    expect(spreadStroke(0)).toBe(BORDER_WIDTH);
    expect(spreadStroke(FOCUS_GAP)).toBe(BORDER_WIDTH + 2 * FOCUS_GAP);
    expect(
      spreadStroke(FOCUS_GAP + FOCUS_WIDTH) - spreadStroke(FOCUS_GAP),
    ).toBe(2 * FOCUS_WIDTH);
  });

  it('is at least 3 pixels thick, to stay visible', () => {
    expect(FOCUS_WIDTH).toBeGreaterThanOrEqual(3);
  });
});

describe('the link handles', () => {
  it('start the link on the tip of the knob', () => {
    expect(OUT_HANDLE_STYLE).toMatchObject({
      left: PORT_X,
      top: '100%',
      height: PORT_DEPTH,
    });
  });

  it('end the link above the mouth of the socket, in line with the knob', () => {
    expect(IN_HANDLE_STYLE.left).toBe(OUT_HANDLE_STYLE.left);
    expect(IN_HANDLE_STYLE.top).toBeLessThan(0);
  });
});
