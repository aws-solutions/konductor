// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/code-pane/code-pane.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-code-pane';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-code-pane";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('code-pane.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the lines and their numbers readable', () => {
    expect(ratio('--wf-code-text', '--wf-code-bg')).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      ratio('--wf-code-text-muted', '--wf-code-bg'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the focus ring visible', () => {
    expect(ratio('--wf-code-focus', '--wf-code-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-code-bg': c.surfaceAlt,
      '--wf-code-border': c.border,
      '--wf-code-text': c.text,
      '--wf-code-text-muted': c.textMuted,
      '--wf-code-focus': c.link,
    });
  });
});

describe('code-pane.css', () => {
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

  it('uses the small radius of the theme module for the box', () => {
    expect(sheet.block('.wf-code-scroll')).toContain(
      `border-radius: ${RADIUS.small}`,
    );
  });
});
