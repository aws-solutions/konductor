// SPDX-License-Identifier: Apache-2.0
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { applyTheme } from '@cloudscape-design/components/theming';
import {
  APP_THEME,
  BAND,
  colorsOf,
  FONT_CODE,
  FONT_TEXT,
  type ThemeMode,
} from './tokens';

// The values that `chrome.css` reads, as custom properties.
const BAND_VARIABLES = {
  '--wf-band-background': BAND.background,
  '--wf-band-divider': BAND.divider,
  '--wf-band-text': BAND.text,
  '--wf-band-text-muted': BAND.textMuted,
  '--wf-band-link': BAND.link,
  '--wf-font-text': FONT_TEXT,
  '--wf-font-code': FONT_CODE,
} as const;

function modeVariables(mode: ThemeMode) {
  const colors = colorsOf(mode);
  return {
    '--wf-color-bg': colors.bg,
    '--wf-color-field': colors.field,
    '--wf-color-surface': colors.surface,
    '--wf-color-surface-alt': colors.surfaceAlt,
    '--wf-color-border': colors.border,
    '--wf-color-border-strong': colors.borderStrong,
    '--wf-color-text': colors.text,
    '--wf-color-text-muted': colors.textMuted,
    '--wf-color-text-subtle': colors.textSubtle,
    '--wf-color-accent': colors.accent,
    '--wf-color-link': colors.link,
    '--wf-color-success': colors.success,
    '--wf-color-error': colors.error,
    '--wf-color-warning': colors.warning,
    '--wf-color-code': colors.code,
    '--wf-color-rail': colors.rail,
    '--wf-page-glow': colors.pageGlow,
  } as const;
}

/**
 * Applies the workflow shell theme to the page. Call it once, before the first
 * render; the theme has a value for each mode. Cloudscape sets fonts on its
 * components only, so the page text outside them gets the font here.
 */
export function installTheme(body: HTMLElement): void {
  body.style.fontFamily = FONT_TEXT;
  body.style.backgroundColor = 'var(--wf-color-bg)';
  body.style.backgroundImage = 'var(--wf-page-glow)';
  body.style.color = 'var(--wf-color-text)';
  for (const [name, value] of Object.entries(BAND_VARIABLES)) {
    body.style.setProperty(name, value);
  }
  applyTheme({ theme: APP_THEME });
}

/**
 * Switches the page, its components and its native controls to `mode`. The
 * root's `data-theme` is what the canvas styles key on.
 */
export function showMode(mode: ThemeMode, root: HTMLElement): void {
  applyMode(mode === 'dark' ? Mode.Dark : Mode.Light);
  for (const [name, value] of Object.entries(modeVariables(mode))) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = mode;
  root.dataset.theme = mode;
}
