// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import {
  CANVAS,
  colorsOf,
  RADIUS,
  type ThemeMode,
} from '../src/theme/tokens.ts';

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
    // The notch is white inside, and its letter is a dark gray.
    expect(
      ratio('--wf-port-letter-in', '--wf-port-notch-bg'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the tab visible on the canvas and on the node', () => {
    expect(ratio('--wf-port-fill', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(ratio('--wf-port-fill', '--wf-node-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });

  it('keeps the card outline visible on the canvas and on the node', () => {
    expect(ratio('--wf-node-border', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(ratio('--wf-node-border', '--wf-node-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);
    const k = CANVAS[mode];
    const expected: Record<string, string> = {
      '--wf-canvas-bg': c.bg,
      '--wf-node-bg': c.surface,
      '--wf-node-border': c.control,
      '--wf-text': c.text,
      '--wf-text-muted': c.textMuted,
      '--wf-focus': c.link,
      '--wf-controls-bg': c.surface,
      '--wf-controls-border': c.borderStrong,
      '--wf-controls-bg-hover': c.infoBg,
      '--wf-canvas-dots': k.dots,
      '--wf-edge': k.edge,
      '--wf-port-fill': k.portFill,
      '--wf-port-rim': k.portRim,
      '--wf-port-letter-out': k.portLetterOut,
      '--wf-port-letter-in': k.portLetterIn,
      '--wf-port-notch-bg': k.portNotchBg,
    };

    expect(v).toEqual(expected);
  });
});

describe('canvas.css shapes', () => {
  it('uses the radius of the theme module for the canvas', () => {
    expect(block('.wf-canvas')).toContain(`border-radius: ${RADIUS.card}`);
  });
});
