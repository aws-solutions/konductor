// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';

/** A style sheet of the page, read so a test can check its `--wf-*` values. */
export interface StyleSheet {
  readonly text: string;
  /** The declarations of the rule that starts with `selector`. */
  block(selector: string): string;
  /** Every `--wf-*` declaration of the rule, whatever its value. */
  declarations(selector: string): Record<string, string>;
}

/** Reads the style sheet at `url`. */
export function readStyleSheet(url: URL): StyleSheet {
  const text = readFileSync(url, 'utf8');
  const block = (selector: string) =>
    text.split(`${selector} {`)[1]?.split('}')[0] ?? '';
  return {
    text,
    block,
    declarations: (selector) =>
      Object.fromEntries(
        [...block(selector).matchAll(/(--wf-[\w-]+):\s*([^;]+);/g)].map((m) => [
          m[1],
          m[2]!.trim(),
        ]),
      ),
  };
}

/** A colour the check accepts: a 6-digit hex value. */
export const HEX_COLOUR = /^#[0-9a-f]{6}$/;

/** Any colour written as a literal, outside a variable. */
export const COLOUR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i;
