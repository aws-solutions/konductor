// SPDX-License-Identifier: Apache-2.0
// The theme hook: sets data-theme on <html>, which switches the token values
// in tokens/colors.css and tokens/effects.css. Until the user toggles, the
// page follows the system setting, including changes made while it is open.

import { useEffect, useRef, useState } from "react";
import { resolveTheme, storedTheme, THEME_KEY, type Theme } from "./model/theme.ts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readStored(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  try {
    return matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readStored(), systemDark()));
  // Kept apart from storage so a choice still holds this session when storage is unavailable.
  const chosen = useRef<boolean>(storedTheme(readStored()) !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = () => {
      if (!chosen.current) setTheme(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    chosen.current = true;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage full or disabled: the choice lasts until the page reloads.
    }
  };

  return { theme, toggle };
}
