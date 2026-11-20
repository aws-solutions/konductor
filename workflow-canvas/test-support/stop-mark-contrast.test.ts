// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/canvas-parts/stop-mark.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-stop';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-stop";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

const FORCED = /@media \(forced-colors: active\) \{([\s\S]*)\}\s*$/;

describe.each(MODES)('stop-mark.css colours in %s', (mode, v) => {
  it('keeps every mark visible on its fill and on the card around it', () => {
    for (const part of [
      '--wf-stop-edge',
      '--wf-stop-passed',
      '--wf-stop-blocked',
      '--wf-stop-not-reached',
    ]) {
      expect(
        contrastRatio(v[part]!, v['--wf-stop-bg']!),
        part,
      ).toBeGreaterThanOrEqual(AA_GRAPHIC);
      expect(
        contrastRatio(v[part]!, colorsOf(mode).surfaceAlt),
        part,
      ).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-stop-bg': c.surface,
      '--wf-stop-edge': c.control,
      '--wf-stop-passed': c.success,
      '--wf-stop-blocked': c.error,
      '--wf-stop-not-reached': c.textMuted,
    });
  });
});

describe('stop-mark.css', () => {
  it('declares its colours as 6-digit hex in the two variable blocks only', () => {
    for (const selector of [LIGHT_BLOCK, DARK_BLOCK]) {
      for (const [name, value] of Object.entries(
        sheet.declarations(selector),
      )) {
        expect(value, name).toMatch(HEX_COLOUR);
      }
    }
    expect(sheet.outside(LIGHT_BLOCK)).not.toMatch(COLOUR_LITERAL);
  });

  it('takes the system colours in forced-colors mode, for every state', () => {
    const forced = FORCED.exec(sheet.text)?.[1] ?? '';

    expect(forced).toContain('.wf-stop[data-state]');
    expect(forced).toMatch(/color: CanvasText/);
    expect(forced).toMatch(/fill: Canvas;/);
  });
});
