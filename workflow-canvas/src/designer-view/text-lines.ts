// SPDX-License-Identifier: Apache-2.0
import type { CodeLine } from '../code-pane/CodeLines';

/**
 * The lines of a text, numbered from 1 as the API counts them: a line ends at
 * `\n`, `\r\n` or a lone `\r`, and a last line with no break is still a line.
 * A break at the very end starts no line, and an empty text has none.
 */
export function textLines(text: string): CodeLine[] {
  if (text === '') return [];
  const parts = text.split(/\r\n|\n|\r/);
  if (parts.at(-1) === '') parts.pop();
  return parts.map((part, index) => ({ n: index + 1, text: part }));
}
