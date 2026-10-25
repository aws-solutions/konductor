// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  initialMode,
  MODE_STORAGE_KEY,
  otherMode,
  rememberMode,
  type ModeEnvironment,
} from './mode';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const systemDark = (dark: boolean) => (query: string) => ({
  matches: dark && query === '(prefers-color-scheme: dark)',
});

describe('initialMode', () => {
  it('uses the saved choice before the system setting', () => {
    const env: ModeEnvironment = {
      localStorage: memoryStorage({ [MODE_STORAGE_KEY]: 'light' }),
      matchMedia: systemDark(true),
    };

    expect(initialMode(env)).toBe('light');
  });

  it('follows the system setting when nothing was saved', () => {
    const storage = memoryStorage();

    expect(
      initialMode({ localStorage: storage, matchMedia: systemDark(true) }),
    ).toBe('dark');
    expect(
      initialMode({ localStorage: storage, matchMedia: systemDark(false) }),
    ).toBe('light');
  });

  it('ignores a saved value that is not a mode', () => {
    const env: ModeEnvironment = {
      localStorage: memoryStorage({ [MODE_STORAGE_KEY]: 'sepia' }),
      matchMedia: systemDark(true),
    };

    expect(initialMode(env)).toBe('dark');
  });

  it('is light when the browser tells nothing', () => {
    expect(initialMode({})).toBe('light');
  });

  it('survives storage that throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(
      initialMode({ localStorage: blocked, matchMedia: systemDark(true) }),
    ).toBe('dark');
    expect(() => rememberMode({ localStorage: blocked }, 'dark')).not.toThrow();
  });
});

describe('rememberMode', () => {
  it('keeps the mode for the next visit', () => {
    const env: ModeEnvironment = { localStorage: memoryStorage() };

    rememberMode(env, 'dark');

    expect(initialMode(env)).toBe('dark');
  });
});

describe('otherMode', () => {
  it('switches between the two modes', () => {
    expect(otherMode('light')).toBe('dark');
    expect(otherMode('dark')).toBe('light');
  });
});
