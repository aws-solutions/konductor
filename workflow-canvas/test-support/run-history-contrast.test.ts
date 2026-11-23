// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/execution/run-history.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-history';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-history";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('run-history.css colours in %s', (mode, v) => {
  it('keeps every text colour readable on the list', () => {
    for (const text of [
      '--wf-history-text',
      '--wf-history-text-muted',
      '--wf-history-running',
      '--wf-history-passed',
      '--wf-history-halted',
    ]) {
      expect(
        contrastRatio(v[text]!, v['--wf-history-bg']!),
        text,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-history-bg': c.surface,
      '--wf-history-border': c.border,
      '--wf-history-text': c.text,
      '--wf-history-text-muted': c.textMuted,
      '--wf-history-running': c.link,
      '--wf-history-passed': c.success,
      '--wf-history-halted': c.error,
    });
  });
});

describe('run-history.css', () => {
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

  it('uses the small radius of the theme module', () => {
    expect(sheet.block(LIGHT_BLOCK)).toContain(
      `border-radius: ${RADIUS.small}`,
    );
  });
});
