// SPDX-License-Identifier: Apache-2.0
// Sun/moon button that switches between the light and dark themes.

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme.ts";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className="theme-toggle" title={label} aria-label={label} onClick={toggle}>
      {theme === "dark" ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
    </button>
  );
}
