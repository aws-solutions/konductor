// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH } from '../src/graph';
import {
  BORDER_WIDTH,
  CARD_RADIUS,
  FOCUS_GAP,
  FOCUS_WIDTH,
  IN_HANDLE_STYLE,
  LETTER_Y,
  NOTCH_RING,
  NOTCH_TOP,
  OUT_HANDLE_STYLE,
  PORT_HEIGHT,
  PORT_SHAPE,
  PORT_WIDTH,
  PORT_X,
  RIM_WIDTH,
  nodeOutline,
  portTransform,
  rimSpreadStroke,
  spreadStroke,
  tabTop,
} from '../src/canvas/jigsaw.ts';

const SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT.stage, radius: 10 };
const count = (path: string, command: string) => path.split(command).length - 1;

describe('the shape of a port', () => {
  it('is a 26 by 16 box with a stem that is narrower than its body', () => {
    expect(PORT_WIDTH).toBe(26);
    expect(PORT_HEIGHT).toBe(16);
    expect(PORT_SHAPE).toBe('M9.5 0V4H7V16H19V4H16.5V0Z');
    // The stem runs from 9.5 to 16.5 and the body from 7 to 19.
    expect(16.5 - 9.5).toBeLessThan(19 - 7);
  });

  it('is one outline for the tab and the notch, and the notch has no line along its mouth', () => {
    expect(PORT_SHAPE).toBe(`${NOTCH_RING}Z`);
    expect(NOTCH_RING.endsWith('Z')).toBe(false);
  });

  it('puts the letter in the middle of the body', () => {
    expect(LETTER_Y).toBeGreaterThan(4);
    expect(LETTER_Y).toBeLessThan(PORT_HEIGHT);
  });

  it('stays clear of the rounded corners and fits in the shortest node', () => {
    expect(PORT_X).toBe(NODE_WIDTH / 2);
    expect(PORT_X + PORT_WIDTH / 2).toBeLessThanOrEqual(
      NODE_WIDTH - CARD_RADIUS - BORDER_WIDTH,
    );
    expect(NOTCH_TOP + PORT_HEIGHT).toBeLessThan(NODE_HEIGHT.end);
  });

  it('puts a tab and a notch in line, whatever the height of the node', () => {
    expect(portTransform(tabTop(76))).toBe(`translate(${PORT_X - 13} 74)`);
    expect(portTransform(NOTCH_TOP)).toBe(`translate(${PORT_X - 13} 2)`);
  });
});

describe('nodeOutline', () => {
  it('is one closed rounded rectangle', () => {
    const path = nodeOutline(SIZE);

    expect(count(path, 'M')).toBe(1);
    expect(path.endsWith('Z')).toBe(true);
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

  it('grows the outline of a tab from the edge of its rim', () => {
    expect(rimSpreadStroke(0)).toBe(RIM_WIDTH);
    expect(
      rimSpreadStroke(FOCUS_GAP + FOCUS_WIDTH) - rimSpreadStroke(FOCUS_GAP),
    ).toBe(2 * FOCUS_WIDTH);
  });

  it('is at least 3 pixels thick, to stay visible', () => {
    expect(FOCUS_WIDTH).toBeGreaterThanOrEqual(3);
  });
});

describe('the link handles', () => {
  it('start the link at the tip of the tab', () => {
    expect(OUT_HANDLE_STYLE).toMatchObject({
      left: PORT_X,
      top: `calc(100% - ${BORDER_WIDTH}px)`,
      height: PORT_HEIGHT,
      width: PORT_WIDTH,
    });
  });

  it('end the link at the top of the notch, in line with the tab', () => {
    expect(IN_HANDLE_STYLE.left).toBe(OUT_HANDLE_STYLE.left);
    expect(IN_HANDLE_STYLE.top).toBe(NOTCH_TOP);
  });
});
