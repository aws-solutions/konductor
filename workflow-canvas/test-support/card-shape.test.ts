// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH } from '../src/graph';
import {
  BORDER_WIDTH,
  CARD_RADIUS,
  FOCUS_GAP,
  FOCUS_WIDTH,
  PORT_DOT_SIZE,
  nodeOutline,
  spreadStroke,
} from '../src/canvas/card-shape.ts';

const css = readFileSync(
  new URL('../src/canvas/canvas.css', import.meta.url),
  'utf8',
);
const SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT.stage, radius: 10 };
const count = (path: string, command: string) => path.split(command).length - 1;

describe('nodeOutline', () => {
  it('is one closed rounded rectangle', () => {
    const path = nodeOutline(SIZE);

    expect(count(path, 'M')).toBe(1);
    expect(path.endsWith('Z')).toBe(true);
    expect(path).not.toContain('Q');
    expect(count(path, 'A')).toBe(4);
  });

  it('runs through the middle of the border', () => {
    const half = BORDER_WIDTH / 2;
    expect(nodeOutline(SIZE).startsWith(`M${half + 10} ${half}L`)).toBe(true);
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

describe('the port dots', () => {
  it('are drawn in canvas.css at the size of the module', () => {
    const rule =
      /\.react-flow \.wf-port::before \{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toContain(`width: ${PORT_DOT_SIZE}px`);
    expect(rule).toContain(`height: ${PORT_DOT_SIZE}px`);
    expect(rule).toContain(`top: -${PORT_DOT_SIZE / 2}px`);
  });

  it('fit on the shortest node, clear of its rounded corners', () => {
    expect(PORT_DOT_SIZE).toBeLessThan(NODE_HEIGHT.end / 2);
    expect(PORT_DOT_SIZE).toBeLessThan(NODE_WIDTH - 2 * CARD_RADIUS);
  });
});
