// SPDX-License-Identifier: Apache-2.0
import { useCallback, useLayoutEffect, useState } from 'react';
import { showMode } from './install';
import { initialMode, otherMode, rememberMode } from './mode';
import type { ThemeMode } from './tokens';

/**
 * The mode of the page and a function that switches it. The first mode is
 * the saved choice or the system setting. Only a switch is saved, so a page
 * that was never switched keeps following the system.
 */
export function useThemeMode(): [ThemeMode, () => void] {
  const [mode, setMode] = useState<ThemeMode>(() => initialMode(window));

  // Before paint, so the first frame is already in the right mode.
  useLayoutEffect(() => {
    showMode(mode, document.documentElement);
  }, [mode]);

  const toggle = useCallback(() => {
    const next = otherMode(mode);
    rememberMode(window, next);
    setMode(next);
  }, [mode]);

  return [mode, toggle];
}
