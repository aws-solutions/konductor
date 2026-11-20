// SPDX-License-Identifier: Apache-2.0
import { promptSpots, type PromptSpot } from './prompt-spots';
import { quoted, scalar } from './scalar-text';

/** What the writer made of a change: the new text, or why it refused. */
export type Written =
  { ok: true; text: string } | { ok: false; reason: string };

/** The prompt that a stage is to have, or `undefined` to leave it as it is. */
export interface PromptWish {
  name: string;
  prompt: string | undefined;
}

const SEE_EDITOR = 'Make the change in a text editor.';

/** Why the writer leaves a prompt as it is. */
const CANNOT_EDIT = {
  unread: `The editor cannot tell where the prompts of this file are, so it cannot change a prompt in place. ${SEE_EDITOR}`,
  mixed: `This file mixes line endings, so the editor cannot change a prompt in place. ${SEE_EDITOR}`,
  file: 'This stage reads its prompt from a file.',
  both: (name: string) =>
    `The stage \`${name}\` has both \`prompt\` and \`prompt_file\`, so the editor does not pick one. ${SEE_EDITOR}`,
  stage: (name: string, why: string) =>
    `${why} The editor cannot change the prompt of the stage \`${name}\` in place. ${SEE_EDITOR}`,
  flow: (name: string, what: string) =>
    `The stage \`${name}\` is written in flow form, as in \`{name: a}\`, so the editor cannot ${what} its prompt in place. ${SEE_EDITOR}`,
  only: (name: string) =>
    `The prompt is the only key on the line of the dash of the stage \`${name}\`, so the editor cannot remove it in place. ${SEE_EDITOR}`,
  readBack: (name: string) =>
    `The editor could not write the prompt of the stage \`${name}\` so that it reads back as typed. ${SEE_EDITOR}`,
} as const;

const BREAK = /[\r\n]/;

/** The line ending the file uses, or `mixed`; `\n` for a file with no break. */
function eolOf(text: string): string {
  const kinds = new Set(text.match(/\r\n|\n|\r/g));
  return kinds.size > 1 ? 'mixed' : ([...kinds][0] ?? '\n');
}

// Characters that a block scalar cannot carry: the C0 and C1 controls other
// than the tab, U+2028 and U+2029 (line breaks to YAML 1.1), the byte order
// mark, the two code points that are not characters, and a lone surrogate. A
// text with one of them, or with a carriage return, is written double-quoted,
// where an escape says it.
const NOT_IN_BLOCK =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\uFEFF\uFFFE\uFFFF\uD800-\uDFFF]/u;

// Whether `text` can be the content of a block scalar: it has something to
// show, and it either has a line break or goes into a block that is there
// already (`keep`).
function blockable(text: string, keep: boolean): boolean {
  return (
    (keep || text.includes('\n')) && /\S/.test(text) && !NOT_IN_BLOCK.test(text)
  );
}

/** The header of a block scalar that is in the file. */
interface Header {
  style: '|' | '>';
  /** The indentation indicator, as the number of spaces it sets. */
  digit?: string;
  /** What follows the indicators on the line: white space and a comment. */
  comment: string;
}

const HEADER = /^([|>])([1-9+-]*)([ \t]+#.*)?/;

// The header at `start`, the first byte of a block scalar.
function headerOf(text: string, start: number): Header {
  let end = start;
  while (end < text.length && !BREAK.test(text[end]!)) end += 1;
  const found = HEADER.exec(text.slice(start, end));
  return {
    style: found?.[1] === '>' ? '>' : '|',
    digit: /[1-9]/.exec(found?.[2] ?? '')?.[0],
    comment: found?.[3] ?? '',
  };
}

// The lines of a block scalar for `text`, the header first. The chomping keeps
// the trailing line breaks of the text: `-` for none, nothing for one and `+`
// for more. A first line that starts with a space needs an indentation
// indicator, or the space would set the indent. The last line has no line break
// after it.
function blockLines(
  text: string,
  style: '|' | '>',
  header: Header | undefined,
  column: number,
): string[] {
  const digit = header?.digit ?? (/^\n*[ ]/.test(text) ? '2' : undefined);
  const indent = ' '.repeat(column + Number(digit ?? 2));
  const body = text.replace(/\n+$/, '');
  const breaks = text.length - body.length;
  const chomp = breaks === 0 ? '-' : breaks === 1 ? '' : '+';
  const content = body
    .split('\n')
    .map((line) => (line === '' ? line : indent + line));
  const kept = Array<string>(Math.max(breaks - 1, 0)).fill('');
  const first = `${style}${digit ?? ''}${chomp}${header?.comment ?? ''}`;
  return [first, ...content, ...kept];
}

/** Some bytes of the text and what takes their place. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * How far a prompt has fallen back from the form that suits it: 0 keeps the
 * style of the block scalar it has, 1 writes a literal block, 2 writes a
 * double-quoted value. A form that does not read back as typed gives way to
 * the next.
 */
type Level = 0 | 1 | 2;

// The value as YAML text. A place that takes a block scalar (`block`) gets one
// when the text fits, in the style the old block had if it reads back (a
// folded block folds line breaks, so text with some does not), else a literal
// one. Otherwise it is on one line, plain when that is safe and double-quoted
// if not. In the flow form every value is quoted, since a comma ends a plain
// one.
function valueText(
  prompt: string,
  spot: PromptSpot,
  eol: string,
  how: { block: boolean; header?: Header; level: Level },
): string {
  const { block, header, level } = how;
  if (block && level < 2 && blockable(prompt, header !== undefined)) {
    const style = header?.style === '>' && level === 0 ? '>' : '|';
    return blockLines(prompt, style, header, spot.column).join(eol);
  }
  return spot.flow || prompt.includes('\n') ? quoted(prompt) : scalar(prompt);
}

// A new value in place of the old one. A block scalar has its line break in
// its span. A value that more follows on its line, such as a comment, takes no
// block, since the last line of the block would run into the rest.
function replacement(
  spot: PromptSpot,
  prompt: string,
  text: string,
  eol: string,
  level: Level,
): Edit {
  const { start, end, block } = spot.value!;
  const endsLine = block || end >= text.length || BREAK.test(text[end]!);
  const header = block ? headerOf(text, start) : undefined;
  const written = valueText(prompt, spot, eol, {
    block: endsLine && !spot.flow,
    header,
    level,
  });
  return { start, end, text: block ? written + eol : written };
}

// A new `prompt` line after the last key of a stage. A last line with no line
// break of its own gets one in front, and the new text has none after it, as
// the file ended.
function insertion(
  spot: PromptSpot,
  prompt: string,
  text: string,
  eol: string,
  level: Level,
): Edit {
  const at = spot.insertAt!;
  const value = valueText(prompt, spot, eol, { block: true, level });
  const line = `${' '.repeat(spot.column)}prompt: ${value}`;
  const lead = at > 0 && !BREAK.test(text[at - 1]!);
  return { start: at, end: at, text: lead ? eol + line : line + eol };
}

// The removal of the `prompt` key with its value: whole lines, or, when the key
// is on the line of the dash, the key and its value up to the next key.
function removal(spot: PromptSpot, text: string): Edit | undefined {
  const { key, value, next } = spot;
  if (key === undefined || !value) return undefined;
  let lineStart = key;
  while (lineStart > 0 && !BREAK.test(text[lineStart - 1]!)) lineStart -= 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, key))) {
    return next === undefined ? undefined : { start: key, end: next, text: '' };
  }
  let end = value.end;
  if (!value.block) {
    while (end < text.length && !BREAK.test(text[end]!)) end += 1;
    end += text.startsWith('\r\n', end) ? 2 : 1;
  }
  // The last line of a file with no final line break takes the break before it
  // along, so the file still ends without one.
  const last = end >= text.length && !BREAK.test(text.at(-1) ?? '');
  const before = text.slice(0, lineStart).match(/\r\n$|[\r\n]$/)?.[0] ?? '';
  const start = last ? lineStart - before.length : lineStart;
  return { start, end: Math.min(end, text.length), text: '' };
}

// The edit that gives the stage the prompt, the reason it cannot, or nothing
// when the stage already has it.
function editFor(
  spot: PromptSpot,
  { name, prompt }: PromptWish,
  text: string,
  eol: string,
  level: Level,
): Edit | string | undefined {
  if (prompt === undefined) return undefined;
  if (spot.refuse && prompt !== spot.text) {
    return CANNOT_EDIT.stage(name, spot.refuse);
  }
  switch (spot.state) {
    case 'blocked':
      return prompt === ''
        ? undefined
        : CANNOT_EDIT.stage(name, spot.reason ?? '');
    case 'file':
      return prompt === '' ? undefined : CANNOT_EDIT.file;
    case 'both':
      return prompt === spot.text ? undefined : CANNOT_EDIT.both(name);
    case 'none':
      if (prompt === '') return undefined;
      return spot.insertAt === undefined
        ? CANNOT_EDIT.flow(name, 'add')
        : insertion(spot, prompt, text, eol, level);
    case 'text':
      if (prompt === spot.text) return undefined;
      if (prompt !== '') return replacement(spot, prompt, text, eol, level);
      if (spot.flow) return CANNOT_EDIT.flow(name, 'remove');
      return removal(spot, text) ?? CANNOT_EDIT.only(name);
  }
}

// The edits from the last offset to the first, so each keeps the offsets of
// the ones before it.
function applied(text: string, edits: readonly Edit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (out, edit) => out.slice(0, edit.start) + edit.text + out.slice(edit.end),
      text,
    );
}

// The stages whose prompt does not read back from `built` as asked for.
function misread(
  built: string,
  before: readonly PromptSpot[],
  wishes: readonly PromptWish[],
): number[] {
  const after = promptSpots(built);
  if (after?.length !== before.length) return wishes.map((_, i) => i);
  return wishes.flatMap(({ prompt }, i) => {
    const was = before[i]!;
    const now = after[i]!;
    const keeps =
      prompt === undefined || ['blocked', 'file', 'both'].includes(was.state);
    const state = keeps ? was.state : prompt === '' ? 'none' : 'text';
    const asked = keeps ? was.text : prompt;
    return now.text === asked && now.state === state ? [] : [i];
  });
}

type Attempt = { reason: string } | { text: string; bad: number[] };

// The text with every wish written, each in the form of its level.
function attempt(
  text: string,
  eol: string,
  spots: readonly PromptSpot[],
  wishes: readonly PromptWish[],
  levels: ReadonlyMap<number, Level>,
): Attempt {
  const edits: Edit[] = [];
  for (const [i, wish] of wishes.entries()) {
    const level = levels.get(i) ?? 0;
    const edit = editFor(spots[i]!, wish, text, eol, level);
    if (typeof edit === 'string') return { reason: edit };
    if (edit) edits.push(edit);
  }
  if (edits.length === 0) return { text, bad: [] };
  if (eol === 'mixed') return { reason: CANNOT_EDIT.mixed };
  const built = applied(text, edits);
  return { text: built, bad: misread(built, spots, wishes) };
}

/**
 * The text with the prompt of each stage set as asked, found with the `yaml`
 * parser: only the bytes of a `prompt` value change, a `prompt` line is added
 * after the last key of a stage that has none, and the lines of one are
 * removed for the empty text. A block scalar stays the style it is where the
 * new text reads back from it. In a file with CRLF line endings the text is
 * written with them and its line breaks are compared without the carriage
 * returns. The result is read again, and a prompt that does not read back as
 * typed is refused, so no text is written that means something else. A stage
 * with `prompt: undefined` stays as it is.
 */
export function withPrompts(
  text: string,
  wishes: readonly PromptWish[],
): Written {
  if (wishes.every(({ prompt }) => prompt === undefined)) {
    return { ok: true, text };
  }
  const spots = promptSpots(text);
  if (spots?.length !== wishes.length) {
    return { ok: false, reason: CANNOT_EDIT.unread };
  }
  const eol = eolOf(text);
  const asked =
    eol === '\r\n'
      ? wishes.map((w) => ({
          ...w,
          prompt: w.prompt?.replaceAll('\r\n', '\n'),
        }))
      : wishes;
  const levels = new Map<number, Level>();
  for (let round = 0; round < 3; round += 1) {
    const made = attempt(text, eol, spots, asked, levels);
    if ('reason' in made) return { ok: false, reason: made.reason };
    if (made.bad.length === 0) return { ok: true, text: made.text };
    for (const i of made.bad) {
      const level = levels.get(i) ?? 0;
      if (level === 2) {
        return { ok: false, reason: CANNOT_EDIT.readBack(asked[i]!.name) };
      }
      levels.set(i, level === 0 ? 1 : 2);
    }
  }
  return { ok: false, reason: CANNOT_EDIT.readBack(asked[0]?.name ?? '') };
}
