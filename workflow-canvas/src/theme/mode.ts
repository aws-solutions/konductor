// SPDX-License-Identifier: Apache-2.0
import type { ThemeMode } from './tokens';

/** The key under which the chosen mode is kept in local storage. */
export const MODE_STORAGE_KEY = 'konductor-workflow-canvas-theme';

/** The parts of `window` that decide the mode. */
export interface ModeEnvironment {
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  matchMedia?: (query: string) => { matches: boolean };
}

function isMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

// Reading `localStorage` can throw when the browser blocks storage.
function storageOf(env: ModeEnvironment) {
  try {
    return env.localStorage;
  } catch {
    return undefined;
  }
}

function storedMode(env: ModeEnvironment): ThemeMode | undefined {
  try {
    const value = storageOf(env)?.getItem(MODE_STORAGE_KEY);
    return isMode(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function systemMode(env: ModeEnvironment): ThemeMode {
  const dark = env.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

/**
 * The mode to show on first paint: the one the person chose before, else the
 * one the system asks for, else light.
 */
export function initialMode(env: ModeEnvironment): ThemeMode {
  return storedMode(env) ?? systemMode(env);
}

/** The mode that a toggle switches to. */
export function otherMode(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : 'dark';
}

/** Keeps a chosen mode for the next visit. A blocked storage is ignored. */
export function rememberMode(env: ModeEnvironment, mode: ThemeMode): void {
  try {
    storageOf(env)?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // The choice then lasts until the page closes.
  }
}
