// SPDX-License-Identifier: Apache-2.0
// Light or dark. A choice made with the toggle is kept in localStorage under
// THEME_KEY; with no stored choice the system setting decides. index.html
// repeats this rule inline so the first paint already has the right colors.

export type Theme = "light" | "dark";

export const THEME_KEY = "komposer-theme";

export function storedTheme(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  return storedTheme(stored) ?? (prefersDark ? "dark" : "light");
}
