// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import {
  CANVAS,
  colorsOf,
  RADIUS,
  WHITE,
  type ThemeMode,
} from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/canvas/canvas.css', import.meta.url),
);
const { block, declarations } = sheet;

const VARIABLE_BLOCKS = ['.wf-canvas', ":root[data-theme='dark'] .wf-canvas"];

const light = declarations('.wf-canvas');
const dark = {
  ...light,
  ...declarations(":root[data-theme='dark'] .wf-canvas"),
};
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

  it('keeps the intent text readable', () => {
    expect(ratio('--wf-intent-text', '--wf-intent-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('keeps the params chip text and edge visible on the intent card', () => {
    expect(ratio('--wf-intent-text', '--wf-intent-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('keeps nodes, edges and the focus ring visible', () => {
    for (const name of ['--wf-node-border', '--wf-edge', '--wf-focus']) {
      expect(ratio(name, '--wf-canvas-bg')).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('keeps the port dots visible on the canvas and on the node', () => {
    expect(ratio('--wf-port', '--wf-canvas-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(ratio('--wf-port', '--wf-node-bg')).toBeGreaterThanOrEqual(
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
      '--wf-intent-bg': c.fill,
      '--wf-intent-border': mode === 'dark' ? c.link : c.fill,
      '--wf-intent-text': WHITE,
      '--wf-port': c.success,
      '--wf-text': c.text,
      '--wf-text-muted': c.textMuted,
      '--wf-focus': c.link,
      '--wf-controls-bg': c.surface,
      '--wf-controls-border': c.borderStrong,
      '--wf-controls-bg-hover': c.infoBg,
      '--wf-canvas-dots': k.dots,
      '--wf-edge': k.edge,
    };

    expect(v).toEqual(expected);
  });
});

describe('canvas.css shapes', () => {
  it('uses the radius of the theme module for the canvas', () => {
    expect(block('.wf-canvas')).toContain(`border-radius: ${RADIUS.card}`);
  });
});

// A colour must be a 6-digit hex variable that the theme module is checked
// against, so that a hand-copied value cannot drift from the palette.
describe('canvas.css colours come only from the checked variables', () => {
  it.each(VARIABLE_BLOCKS)('declares %s colours as 6-digit hex', (selector) => {
    for (const [name, value] of Object.entries(declarations(selector))) {
      expect(value, name).toMatch(HEX_COLOUR);
    }
  });

  it('writes no colour outside the two variable blocks', () => {
    expect(sheet.outside('.wf-canvas')).not.toMatch(COLOUR_LITERAL);
  });
});
