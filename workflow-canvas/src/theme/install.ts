// SPDX-License-Identifier: Apache-2.0
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { applyTheme } from '@cloudscape-design/components/theming';
import {
  APP_THEME,
  FONT_TEXT,
  TAB_STRIP_THEME,
  type ThemeMode,
} from './tokens';

/** Where the tab strip of the page header is, for `TAB_STRIP_THEME`. */
export const TAB_STRIP_SELECTOR = '.wf-tab-strip [role="tablist"]';

/**
 * Applies the konductor docs theme to the page. Call it once, before the
 * first render; the theme has a value for each mode. Cloudscape sets fonts on
 * its components only, so the page text outside them gets the font here.
 */
export function installTheme(body: HTMLElement): void {
  body.style.fontFamily = FONT_TEXT;
  applyTheme({ theme: APP_THEME });
  applyTheme({ theme: TAB_STRIP_THEME, selector: TAB_STRIP_SELECTOR });
}

/** Switches the page, its components and its native controls to `mode`. */
export function showMode(mode: ThemeMode, root: HTMLElement): void {
  applyMode(mode === 'dark' ? Mode.Dark : Mode.Light);
  root.style.colorScheme = mode;
}
