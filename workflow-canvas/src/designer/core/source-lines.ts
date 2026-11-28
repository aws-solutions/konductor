// SPDX-License-Identifier: Apache-2.0

/** One source line and the line break that follows it. */
export interface SourceLine {
  readonly text: string;
  readonly eol: string;
  readonly made?: true;
}

export interface ScalarSpanOptions {
  /** Characters that cannot start this writer's accepted plain scalar. */
  readonly forbiddenFirst: RegExp;
}

/** Splits text without normalizing its line endings or final-line state. */
export function linesOf(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let end = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n)/g)) {
    lines.push({ text: match[1] ?? '', eol: match[2] ?? '' });
    end = match.index + match[0].length;
  }
  if (end < text.length) lines.push({ text: text.slice(end), eol: '' });
  return lines;
}

/** The index after the quote that closes a scalar, or -1. */
export function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === '\\') index += 1;
    else if (text[index] === quote) {
      if (quote === "'" && text[index + 1] === "'") index += 1;
      else return index + 1;
    }
  }
  return -1;
}

/** A same-line scalar span under one writer's explicit scalar rules. */
export function scalarSpan(
  text: string,
  from: number,
  { forbiddenFirst }: ScalarSpanOptions,
): { start: number; end: number } | undefined {
  const start = from + /^[ \t]*/.exec(text.slice(from))![0].length;
  const first = text[start];
  if (first === undefined || forbiddenFirst.test(first)) return undefined;
  if (first === '"' || first === "'") {
    const end = closingQuote(text, start);
    return end > 0 && /^[ \t]*(?:#.*)?$/.test(text.slice(end))
      ? { start, end }
      : undefined;
  }
  const comment = text.slice(start).search(/[ \t]#/);
  let end = comment < 0 ? text.length : start + comment;
  while (end > start && /[ \t]/.test(text[end - 1]!)) end -= 1;
  return end > start ? { start, end } : undefined;
}
