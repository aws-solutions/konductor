// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from './contrast';
import {
  APP_THEME,
  BAND,
  colorsOf,
  TAB_STRIP_STYLE,
  TAB_STRIP_THEME,
  WHITE,
  type ThemeMode,
} from './tokens';

const MODES: ThemeMode[] = ['light', 'dark'];

describe.each(MODES)('the %s palette', (mode) => {
  const c = colorsOf(mode);

  it.each([
    ['text on the page', c.text, c.bg],
    ['text on a surface', c.text, c.surface],
    ['muted text on a surface', c.textMuted, c.surface],
    ['muted text on the page', c.textMuted, c.bg],
    ['muted text on a raised area', c.textMuted, c.surfaceAlt],
    ['links on a surface', c.link, c.surface],
    ['hovered links on a surface', c.linkHover, c.surface],
    ['white text on a filled button', WHITE, c.fill],
    ['white text on a hovered filled button', WHITE, c.fillHover],
    ['success text on a surface', c.success, c.surface],
    ['error text on a surface', c.error, c.surface],
    ['warning text on a surface', c.warning, c.surface],
    ['success text on its wash', c.success, c.successBg],
    ['error text on its wash', c.error, c.errorBg],
    ['warning text on its wash', c.warning, c.warningBg],
  ])('has AA contrast for %s', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('draws control edges that reach 3:1 on the surface and the field', () => {
    expect(contrastRatio(c.control, c.surface)).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
    expect(contrastRatio(c.control, c.field)).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });
});

describe('the header band', () => {
  it.each([BAND.text, BAND.textMuted, BAND.link])(
    'has AA contrast for %s',
    (colour) => {
      expect(contrastRatio(colour, BAND.background)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    },
  );

  it('draws the selected-tab indicator at 3:1 or more on the band', () => {
    expect(contrastRatio(BAND.link, BAND.background)).toBeGreaterThanOrEqual(
      AA_GRAPHIC,
    );
  });
});

describe('TAB_STRIP_THEME', () => {
  it('colours the selected-tab indicator from the band', () => {
    expect(TAB_STRIP_THEME.tokens.colorBorderItemSelected).toBe(BAND.link);
  });

  it('colours the line between tabs from the band', () => {
    expect(TAB_STRIP_STYLE.tabSeparator.color).toBe(BAND.divider);
  });
});

describe('APP_THEME', () => {
  it('gives the base font to the page', () => {
    expect(APP_THEME.tokens.fontFamilyBase).toMatch(/^Outfit,/);
    expect(APP_THEME.tokens.fontFamilyMonospace).toMatch(/^'JetBrains Mono',/);
  });

  it('gives every colour a value for both modes', () => {
    const colourTokens = Object.entries(APP_THEME.tokens).filter(
      ([name, value]) => name.startsWith('color') && typeof value === 'object',
    );

    expect(colourTokens.length).toBeGreaterThan(40);
    for (const [, value] of colourTokens) {
      expect(value).toHaveProperty('light');
      expect(value).toHaveProperty('dark');
    }
  });
});
