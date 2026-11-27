// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AA_GRAPHIC, AA_TEXT, contrastRatio } from '../src/theme/contrast.ts';
import { colorsOf, WHITE, type ThemeMode } from '../src/theme/tokens.ts';

const MODES: readonly ThemeMode[] = ['light', 'dark'];

describe.each(MODES)('the %s shell chrome', (mode) => {
  const colors = colorsOf(mode);

  it.each([
    ['top bar text', colors.text, colors.surface],
    ['top bar muted text', colors.textMuted, colors.surface],
    ['state success', colors.success, colors.bg],
    ['state warning', colors.warning, colors.bg],
    ['flow link', colors.link, colors.bg],
    ['selected view', WHITE, colors.fill],
  ])('has AA contrast for %s', (_name, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('draws the focus ring against both top bar surfaces', () => {
    for (const background of [colors.surface, colors.field]) {
      expect(contrastRatio(colors.accent, background)).toBeGreaterThanOrEqual(
        AA_GRAPHIC,
      );
    }
  });
});
