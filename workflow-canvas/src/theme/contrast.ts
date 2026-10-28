// SPDX-License-Identifier: Apache-2.0

function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const digits = hex.replace('#', '');
  return (
    0.2126 * channel(digits, 0) +
    0.7152 * channel(digits, 2) +
    0.0722 * channel(digits, 4)
  );
}

/** The WCAG 2 contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The least ratio for body text (WCAG 2 AA). */
export const AA_TEXT = 4.5;
/** The least ratio for the edge of a control or an icon (WCAG 2 AA). */
export const AA_GRAPHIC = 3;

/** The `#rrggbb` colour of a translucent `rgba(r, g, b, a)` laid over `backing`. */
export function blend(rgba: string, backing: string): string {
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(rgba);
  if (!match) throw new Error(`Not an rgba colour: ${rgba}`);
  const alpha = Number(match[4]);
  const digits = backing.replace('#', '');
  return (
    '#' +
    [1, 2, 3]
      .map((group, index) => {
        const below = parseInt(digits.slice(index * 2, index * 2 + 2), 16);
        const mixed = Number(match[group]) * alpha + below * (1 - alpha);
        return Math.round(mixed).toString(16).padStart(2, '0');
      })
      .join('')
  );
}
