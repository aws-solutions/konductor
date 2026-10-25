// SPDX-License-Identifier: Apache-2.0
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { applyTheme } from '@cloudscape-design/components/theming';
import {
  APP_THEME,
  BAND,
  FONT_TEXT,
  TAB_STRIP_THEME,
  type ThemeMode,
} from './tokens';

/**
 * Where the strip of the page tabs is, for `TAB_STRIP_THEME`: the element
 * that holds the tab list, found through its role so no library class is
 * needed. `chrome.css` paints the same element with the band.
 */
export const TAB_STRIP_SELECTOR = '.wf-tab-strip :has(> * > [role="tablist"])';

// The band colours that `chrome.css` reads, as custom properties.
const BAND_VARIABLES = {
  '--wf-band-background': BAND.background,
  '--wf-band-divider': BAND.divider,
} as const;

/**
 * Applies the konductor docs theme to the page. Call it once, before the
 * first render; the theme has a value for each mode. Cloudscape sets fonts on
 * its components only, so the page text outside them gets the font here.
 */
export function installTheme(body: HTMLElement): void {
  body.style.fontFamily = FONT_TEXT;
  for (const [name, value] of Object.entries(BAND_VARIABLES)) {
    body.style.setProperty(name, value);
  }
  applyTheme({ theme: APP_THEME });
  applyTheme({ theme: TAB_STRIP_THEME, selector: TAB_STRIP_SELECTOR });
}

/**
 * Switches the page, its components and its native controls to `mode`. The
 * root's `data-theme` is what the canvas styles key on.
 */
export function showMode(mode: ThemeMode, root: HTMLElement): void {
  applyMode(mode === 'dark' ? Mode.Dark : Mode.Light);
  root.style.colorScheme = mode;
  root.dataset.theme = mode;
}
