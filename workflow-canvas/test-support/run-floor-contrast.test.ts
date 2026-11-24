// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, RADIUS, type ThemeMode } from '../src/theme/tokens.ts';
import { COLOUR_LITERAL, HEX_COLOUR, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/execution/run-floor.css', import.meta.url),
);
const LIGHT_BLOCK = '.wf-floor';
const DARK_BLOCK = ":root[data-theme='dark'] .wf-floor";

const light = sheet.declarations(LIGHT_BLOCK);
const MODES: [ThemeMode, Record<string, string>][] = [
  ['light', light],
  ['dark', { ...light, ...sheet.declarations(DARK_BLOCK) }],
];

describe.each(MODES)('run-floor.css colours in %s', (mode, v) => {
  const ratio = (a: string, b: string) => contrastRatio(v[a]!, v[b]!);

  it('keeps the stage text readable, picked or not', () => {
    for (const bg of ['--wf-floor-bg', '--wf-floor-current-bg']) {
      for (const text of ['--wf-floor-text', '--wf-floor-text-muted']) {
        expect(ratio(text, bg), `${text} on ${bg}`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    }
  });

  it('keeps the edges, the picked mark and the focus ring visible', () => {
    expect(ratio('--wf-floor-edge', '--wf-floor-bg')).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(
      ratio('--wf-floor-current-edge', '--wf-floor-current-bg'),
    ).toBeGreaterThanOrEqual(AA_GRAPHIC);
    expect(
      contrastRatio(v['--wf-floor-focus']!, colorsOf(mode).bg),
    ).toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  it('uses the colours of the theme module, and names every one it uses', () => {
    const c = colorsOf(mode);

    expect(v).toEqual({
      '--wf-floor-bg': c.surface,
      '--wf-floor-text': c.text,
      '--wf-floor-text-muted': c.textMuted,
      '--wf-floor-edge': c.control,
      '--wf-floor-current-bg': c.infoBg,
      '--wf-floor-current-edge': c.link,
      '--wf-floor-focus': c.link,
    });
  });
});

describe('run-floor.css', () => {
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
});
