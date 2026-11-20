// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/designer-view/designer-layout.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-layout';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-layout";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('designer-layout.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the tabs, the fold button and the notes readable', () => {
    for (const text of ['--wf-layout-text', '--wf-layout-text-muted']) {
      expect(ratio(text, '--wf-layout-bg'), text).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it('keeps the edges, the selected tab mark and the focus ring visible', () => {
    for (const part of [
      '--wf-layout-edge',
      '--wf-layout-selected',
      '--wf-layout-focus',
    ]) {
      expect(ratio(part, '--wf-layout-bg'), part).toBeGreaterThanOrEqual(
        AA_GRAPHIC,
      );
    }
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-layout-bg': c.surface,
      '--wf-layout-border': c.border,
      '--wf-layout-text': c.text,
      '--wf-layout-text-muted': c.textMuted,
      '--wf-layout-edge': c.control,
      '--wf-layout-selected': c.link,
      '--wf-layout-focus': c.link,
    });
  });
});

describe('designer-layout.css', () => {
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

  it('uses the small radius of the theme module, and no smooth scrolling', () => {
    expect(sheet.text).toContain(`border-radius: ${RADIUS.small}`);
    expect(sheet.text).not.toMatch(/scroll-behavior:\s*smooth/);
  });

  it('marks the selected tab and the focus with system colours in forced-colors mode', () => {
    expect(sheet.text).toMatch(
      /@media \(forced-colors: active\) \{[\s\S]*Highlight/,
    );
  });
});
