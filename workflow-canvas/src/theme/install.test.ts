// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { showMode } from './install';
import { colorsOf, type ThemeMode } from './tokens';

const MODES: readonly ThemeMode[] = ['light', 'dark'];

describe.each(MODES)('showMode, %s', (mode) => {
  it('sets the shell palette as CSS variables', () => {
    const root = document.createElement('html');
    const colors = colorsOf(mode);

    showMode(mode, root);

    expect(root.style.getPropertyValue('--wf-color-bg')).toBe(colors.bg);
    expect(root.style.getPropertyValue('--wf-color-surface')).toBe(
      colors.surface,
    );
    expect(root.style.getPropertyValue('--wf-color-text')).toBe(colors.text);
    expect(root.style.getPropertyValue('--wf-color-accent')).toBe(
      colors.accent,
    );
    expect(root.style.getPropertyValue('--wf-color-code')).toBe(colors.code);
    expect(root.style.getPropertyValue('--wf-page-glow')).toBe(colors.pageGlow);
  });
});
