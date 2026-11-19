// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/execution/run-progress.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-progress';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-progress";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('run-progress.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the summary and the elapsed time readable', () => {
    expect(
      ratio('--wf-progress-text', '--wf-progress-bg'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      ratio('--wf-progress-text-muted', '--wf-progress-bg'),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps the bar and its parts visible', () => {
    expect(
      ratio('--wf-progress-edge', '--wf-progress-bg'),
    ).toBeGreaterThanOrEqual(AA_GRAPHIC);
    for (const part of ['--wf-progress-passed', '--wf-progress-blocked']) {
      expect(ratio(part, '--wf-progress-track')).toBeGreaterThanOrEqual(
        AA_GRAPHIC,
      );
    }
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-progress-bg': c.surface,
      '--wf-progress-text': c.text,
      '--wf-progress-text-muted': c.textMuted,
      '--wf-progress-track': c.surfaceAlt,
      '--wf-progress-edge': c.control,
      '--wf-progress-passed': c.success,
      '--wf-progress-blocked': c.error,
    });
  });
});

describe('run-progress.css', () => {
  it('declares its colours as 6-digit hex in the two variable blocks only', () => {
    for (const selector of [LIGHT_BLOCK, DARK_BLOCK]) {
      for (const [name, value] of Object.entries(
        sheet.declarations(selector),
      )) {
        expect(value, name).toMatch(HEX_COLOUR);
      }
    }
    const outside = sheet.text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\.wf-progress \{[^}]*\}/g, '');

    expect(outside).not.toMatch(COLOUR_LITERAL);
  });

  it('uses the small radius of the theme module', () => {
    expect(sheet.block(LIGHT_BLOCK)).toContain(
      `border-radius: ${RADIUS.small}`,
    );
  });
});
