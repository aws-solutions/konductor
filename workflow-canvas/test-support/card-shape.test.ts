// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH } from '../src/graph';
import {
  BORDER_WIDTH,
  FOCUS_GAP,
  FOCUS_WIDTH,
  NODE_RADIUS,
  PORT_DOT_SIZE,
  nodeOutline,
  spreadStroke,
} from '../src/canvas/card-shape.ts';

const css = readFileSync(
  new URL('../src/canvas/canvas.css', import.meta.url),
  'utf8',
);
const SIZE = {
  width: NODE_WIDTH.stage,
  height: NODE_HEIGHT.stage,
  radius: NODE_RADIUS.stage,
};
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
    expect(
      nodeOutline(SIZE).startsWith(`M${half + SIZE.radius} ${half}L`),
    ).toBe(true);
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

const cssRule = (selector: string) =>
  new RegExp(`${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(
    css,
  )?.[1] ?? '';

describe('the port dots', () => {
  const handle = cssRule('.react-flow .wf-port');
  const dot = cssRule('.react-flow .wf-port::before');

  it('take their size in canvas.css from the module', () => {
    expect(handle).toContain(`--wf-port-dot-size: ${PORT_DOT_SIZE}px;`);
  });

  it('size the handle and the dot from that one property', () => {
    expect(handle).toContain('width: var(--wf-port-dot-size);');
    expect(dot).toContain('width: var(--wf-port-dot-size);');
    expect(dot).toContain('height: var(--wf-port-dot-size);');
    expect(dot).toContain('top: calc(var(--wf-port-dot-size) / -2);');
  });

  it.each(Object.entries(NODE_HEIGHT))(
    'fit on the %s node, clear of its rounded corners',
    (kind, height) => {
      const nodeKind = kind as keyof typeof NODE_RADIUS;
      const radius = NODE_RADIUS[nodeKind];
      const width = NODE_WIDTH[nodeKind];

      expect(PORT_DOT_SIZE).toBeLessThan(height / 2);
      expect(PORT_DOT_SIZE).toBeLessThan(width - 2 * radius);
    },
  );
});
