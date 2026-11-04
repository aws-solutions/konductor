// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ESTIMATED_FOR } from '../src/canvas/clipping.ts';
import { NODE_WIDTH } from '../src/graph/layout.ts';

const css = readFileSync(
  new URL('../src/canvas/canvas.css', import.meta.url),
  'utf8',
);

describe('the node geometry the limits were estimated for', () => {
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.]/g, '\\.');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  };

  it('is the width the layout gives a node, which the CSS fills', () => {
    expect(NODE_WIDTH).toBe(ESTIMATED_FOR.nodeWidthPx);
    expect(rule('.wf-node')).toMatch(/\bwidth:\s*100%/);
  });

  it('is the font size, padding and line clamp in canvas.css', () => {
    expect(rule('.wf-node-title')).toContain(
      `font-size: ${ESTIMATED_FOR.titleFontPx}px`,
    );
    expect(rule('.wf-node')).toContain(
      `font-size: ${ESTIMATED_FOR.subFontPx}px`,
    );
    expect(rule('.wf-node')).toMatch(
      new RegExp(`padding:\\s*\\d+px ${ESTIMATED_FOR.paddingXPx}px`),
    );
    expect(rule('.wf-node-intent-outcome')).toContain(
      `line-clamp: ${ESTIMATED_FOR.outcomeLines}`,
    );
  });
});
