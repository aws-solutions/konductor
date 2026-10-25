// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';

const css = readFileSync(
  new URL('../src/canvas/canvas.css', import.meta.url),
  'utf8',
);

// The declarations of the rule that starts with `selector`.
function block(selector: string): string {
  return css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
}

function variables(selector: string): Record<string, string> {
  return Object.fromEntries(
    [...block(selector).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

const light = variables('.wf-canvas');
const dark = { ...light, ...variables(":root[data-theme='dark'] .wf-canvas") };
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', dark],
];

describe.each(MODES)('canvas.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the canvas text readable', () => {
    expect(ratio('--wf-text', '--wf-node-bg')).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio('--wf-text-muted', '--wf-node-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(ratio('--wf-text-muted', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(ratio('--wf-text', '--wf-controls-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('keeps nodes, edges and the focus ring visible', () => {
    for (const name of ['--wf-node-border', '--wf-edge', '--wf-focus']) {
      expect(ratio(name, '--wf-canvas-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('keeps the port letters readable on their ports', () => {
    expect(
      ratio('--wf-port-letter-out', '--wf-port-fill'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      ratio('--wf-port-letter-in', '--wf-port-inner'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the ports visible on the canvas and on the node', () => {
    for (const part of ['--wf-port-fill', '--wf-port-ring']) {
      expect(ratio(part, '--wf-canvas-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
      expect(ratio(part, '--wf-node-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('uses the colours of the theme module', () => {
    const c = colorsOf(mode);

    expect(v['--wf-canvas-bg']).toBe(c.bg);
    expect(v['--wf-node-bg']).toBe(c.surface);
    expect(v['--wf-node-border']).toBe(c.control);
    expect(v['--wf-text']).toBe(c.text);
    expect(v['--wf-focus']).toBe(c.link);
    expect(v['--wf-controls-bg']).toBe(c.surface);
    expect(v['--wf-controls-border']).toBe(c.borderStrong);
    expect(v['--wf-controls-bg-hover']).toBe(c.infoBg);
  });
});

describe('canvas.css shapes', () => {
  it('uses the radii of the theme module', () => {
    expect(block('.wf-canvas')).toContain(`border-radius: ${RADIUS.card}`);
    expect(block('.wf-node')).toContain(`border-radius: ${RADIUS.control}`);
  });
});
