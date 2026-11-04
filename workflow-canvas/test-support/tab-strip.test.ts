// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAB_STRIP_SELECTOR } from '../src/theme/tokens.ts';

const css = readFileSync(
  new URL('../src/chrome/chrome.css', import.meta.url),
  'utf8',
);

// The selector of the first rule that paints the tab strip.
function paintedSelector(): string {
  return css.match(/^(\.wf-tab-strip[^{]*)\{/m)?.[1]?.trim() ?? '';
}

describe('the tab strip selector', () => {
  it('is the same in chrome.css and in the theme installer', () => {
    // Prettier writes quotes one way in CSS and another in TypeScript.
    const unquote = (selector: string) => selector.replaceAll(/["']/g, '');

    expect(paintedSelector()).not.toBe('');
    expect(unquote(paintedSelector())).toBe(unquote(TAB_STRIP_SELECTOR));
  });
});
