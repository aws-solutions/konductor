// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODE_STORAGE_KEY } from '../src/theme/mode.ts';
import { inlineScriptOf } from './inline-script.ts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = inlineScriptOf(html);

interface FakeRoot {
  style: { colorScheme?: string };
  dataset: { theme?: string };
}

// Runs the inline script of the page against a stand-in for the browser.
function runWith(saved: string | null | 'blocked', systemDark: boolean) {
  const root: FakeRoot = { style: {}, dataset: {} };
  const keys: string[] = [];
  const localStorage = {
    getItem(key: string) {
      keys.push(key);
      if (saved === 'blocked') throw new Error('blocked');
      return saved;
    },
  };
  const matchMedia = () => ({ matches: systemDark });
  new Function('document', 'localStorage', 'matchMedia', script)(
    { documentElement: root },
    localStorage,
    matchMedia,
  );
  return { root, keys };
}

describe('the inline script of index.html', () => {
  it('reads the same storage key as the app', () => {
    expect(runWith(null, false).keys).toEqual([MODE_STORAGE_KEY]);
  });

  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
    ['blocked', true, 'dark'],
    ['nonsense', true, 'dark'],
  ] as const)(
    'with saved %s and system dark %s sets %s',
    (saved, systemDark, expected) => {
      const { root } = runWith(saved, systemDark);

      expect(root.dataset.theme).toBe(expected);
      expect(root.style.colorScheme).toBe(expected);
    },
  );
});
