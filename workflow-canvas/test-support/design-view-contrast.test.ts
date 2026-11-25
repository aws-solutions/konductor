// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/design-view/design-view.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-design-view';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-design-view";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('design-view.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the text of the view readable on its surface', () => {
    for (const text of ['--wf-design-text', '--wf-design-text-muted']) {
      expect(ratio(text, '--wf-design-bg')).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-design-bg': c.surface,
      '--wf-design-text': c.text,
      '--wf-design-text-muted': c.textMuted,
    });
  });
});

describe('design-view.css', () => {
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
});
