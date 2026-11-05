// SPDX-License-Identifier: Apache-2.0
import type { StageView, WorkflowView } from '../../api/types';

// A value that a plain YAML scalar reads back as the same text: it starts
// with a letter, has no character that YAML gives a meaning, and does not end
// in a space. Words that YAML 1.1 reads as booleans or null are left out, so
// an editor on that version reads the same text.
const PLAIN = /^[A-Za-z](?:[A-Za-z0-9 _.,()/-]*[A-Za-z0-9_.,()/-])?$/;
const NOT_TEXT = /^(?:true|false|null|y|n|yes|no|on|off)$/i;

// The value as YAML text: plain when that is safe, double-quoted if not.
function scalar(value: string): string {
  return PLAIN.test(value) && !NOT_TEXT.test(value)
    ? value
    : JSON.stringify(value);
}

/** A stage to write: its name and agent, and the stage of the file it was. */
export interface StageToWrite extends StageView {
  /**
   * The place of the stage in the view that the text was read as. It is left
   * out for a stage that the file does not have yet.
   */
  from?: number;
}

/**
 * What the writer made of a change: the new text, or the reason it cannot
 * write the change without rewriting more of the file than the change.
 */
export type Written =
  { ok: true; text: string } | { ok: false; reason: string };

/** One line of a file and the line break that ends it (empty at the end). */
interface Line {
  text: string;
  eol: string;
  /** Set on a line that the writer made, as opposed to one the file had. */
  made?: true;
}

// The contract takes `\r\n`, `\n` and a lone `\r` as line breaks.
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let end = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n)/g)) {
    lines.push({ text: match[1] ?? '', eol: match[2] ?? '' });
    end = match.index + match[0].length;
  }
  if (end < text.length) lines.push({ text: text.slice(end), eol: '' });
  return lines;
}

const BOM = '\uFEFF';
// The `stages:` key of the top level, quoted or not, with an optional comment.
const STAGES_KEY = /^(?:stages|"stages"|'stages'):[ \t]*(?:#.*)?$/;
// A line that starts the next top-level key or a document marker, which
// ends the block of stages. A `-` at the start is an item of the block.
const NEXT_KEY = /^(?:[^\s#-]|---|\.\.\.)/;
const BLANK = /^[ \t]*$/;
const COMMENT = /^[ \t]*#/;
const ITEM_START = /^[ \t]*-(?:[ \t]|$)/;
// The header of a block scalar that keeps its trailing blank lines (`|+`,
// `>2+`), whose blank lines at the end of the item are part of the value.
const KEEP_CHOMPING = /:[ \t]+[|>](?:[1-9]?\+|\+[1-9])[ \t]*(?:#.*)?$/;
// Where the dashes go in a list that has no item yet.
const DEFAULT_DASH = '  ';

const isFiller = (line: Line) =>
  BLANK.test(line.text) || COMMENT.test(line.text);
const indentOf = (line: Line) => /^[ \t]*/.exec(line.text)![0];

/** Why the writer leaves a file or a stage as it is. */
const CANNOT_EDIT = {
  notABlock:
    'The stages of this file are written in brackets, as in `stages: [...]`, or not under a top-level `stages:` key, so the editor cannot change them in place. Make the change in a text editor.',
  unmatched:
    'The editor cannot tell where each stage of this file starts, so it cannot change the stages in place. Make the change in a text editor.',
  stage: (name: string) =>
    `The stage \`${name}\` is not written with one key to a line under its dash, so the editor cannot change it in place. Make the change in a text editor.`,
  value: (key: string, name: string) =>
    `The \`${key}\` of the stage \`${name}\` is not one value on the line of its key, so the editor cannot change it in place. Make the change in a text editor.`,
} as const;

// A stage as the file wrote it: the lines of its item, with the comments and
// blank lines in front of it. `lead` counts those, so the dash is at `lead`.
interface Item {
  lines: Line[];
  lead: number;
}

// How the file lays out its list: the comments in front of the first item,
// the lines where the items start, and the indent of their dashes. An item
// is a line at the shortest dash indent; a dash further in belongs to the
// item above it, as in a list of tags.
interface Layout {
  head: Line[];
  starts: number[];
  dash: string;
}

// The layout of `block`, or `undefined` when something other than comments
// stands in front of the first item, such as a list in the flow form on the
// line below `stages:`. Such a list cannot take items next to it.
function layoutOf(block: Line[]): Layout | undefined {
  const dashes = block.flatMap((line, i) =>
    ITEM_START.test(line.text) ? [{ i, indent: indentOf(line) }] : [],
  );
  const dash = dashes.reduce(
    (least, { indent }) => (indent.length < least.length ? indent : least),
    dashes[0]?.indent ?? DEFAULT_DASH,
  );
  const starts = dashes.filter((d) => d.indent === dash).map((d) => d.i);
  const head = block.slice(0, starts[0] ?? block.length);
  return head.every(isFiller) ? { head, starts, dash } : undefined;
}

// Whether a line at the end of an item belongs in front of the next one: a
// blank line, or a comment no further in than the dashes. A comment further
// in, or a line of a block scalar that starts with `#`, stays with its item,
// and so do the blank lines of an item whose block scalar keeps them.
function movesOn(line: Line, dash: string, keepsBlanks: boolean): boolean {
  if (BLANK.test(line.text)) return !keepsBlanks;
  return COMMENT.test(line.text) && indentOf(line).length <= dash.length;
}

// Splits the lines after the head at the start of each item. Comments and
// blank lines between two items go with the one after them, and those after
// the last item are the `rest`, which stays in place.
function itemsOf(
  block: Line[],
  { starts, dash }: Layout,
): { items: Item[]; rest: Line[] } {
  let lead: Line[] = [];
  const items = starts.map((start, n) => {
    const body = block.slice(start, starts[n + 1] ?? block.length);
    const keepsBlanks = body.some((line) => KEEP_CHOMPING.test(line.text));
    let cut = body.length;
    while (cut > 1 && movesOn(body[cut - 1]!, dash, keepsBlanks)) cut -= 1;
    const item = { lines: [...lead, ...body.slice(0, cut)], lead: lead.length };
    lead = body.slice(cut);
    return item;
  });
  return { items, rest: lead };
}

// A new item in the layout of the list: its dashes where the others have
// them, and the agent in line with the name.
function generated(stage: StageView, eol: string, dash: string): Line[] {
  return [
    { text: `${dash}- name: ${scalar(stage.name)}`, eol, made: true },
    { text: `${dash}  agent: ${scalar(stage.agent)}`, eol, made: true },
  ];
}

const sameStage = (a: StageView, b: StageView) =>
  a.name === b.name && a.agent === b.agent;

// A key of a block mapping at the start of `text`, plain or quoted, followed
// by its colon. The name of the key is in one of the three groups.
const KEY =
  /^(?:([A-Za-z_][A-Za-z0-9_-]*)|"([^"\\]*)"|'([^']*)')[ \t]*:(?=[ \t]|$)/;
// A dash with a key after it, and a dash with nothing but a comment.
const DASH_WITH_KEY = /^[ \t]*- +(?=[^\s#])/;
const DASH_ALONE = /^[ \t]*-[ \t]*(?:#.*)?$/;

// The column where the keys of the item's mapping start, or `undefined` when
// the item is not a block mapping, such as `- {name: a, agent: b}`.
function columnOf(item: Item): number | undefined {
  const dashLine = item.lines[item.lead]!.text;
  const withKey = DASH_WITH_KEY.exec(dashLine);
  if (withKey) {
    return KEY.test(dashLine.slice(withKey[0].length))
      ? withKey[0].length
      : undefined;
  }
  if (!DASH_ALONE.test(dashLine)) return undefined;
  const first = item.lines.slice(item.lead + 1).find((line) => !isFiller(line));
  const column = first && indentOf(first);
  return column && column.length > indentOf(item.lines[item.lead]!).length
    ? column.length
    : undefined;
}

// The span of a scalar that starts at `from` and ends on the same line:
// plain, or quoted and closed. `undefined` for anything else, such as a value
// on the next line, a block scalar, a flow collection, an anchor or a tag.
function scalarSpan(
  text: string,
  from: number,
): { start: number; end: number } | undefined {
  const start = from + /^[ \t]*/.exec(text.slice(from))![0].length;
  const first = text[start];
  if (first === undefined || /[#|>&*!{}[\]%@`,?]/.test(first)) return undefined;
  let end: number;
  if (first === '"' || first === "'") {
    end = closingQuote(text, start);
    if (end < 0) return undefined;
    if (!/^[ \t]*(?:#.*)?$/.test(text.slice(end))) return undefined;
  } else {
    const comment = text.slice(start).search(/[ \t]#/);
    end = comment < 0 ? text.length : start + comment;
    while (end > start && /[ \t]/.test(text[end - 1]!)) end -= 1;
  }
  return { start, end };
}

// The index after the quote that closes the quoted scalar at `start`, or -1.
function closingQuote(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (quote === '"' && text[i] === '\\') i += 1;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i += 1;
      else return i + 1;
    }
  }
  return -1;
}

// What YAML reads the scalar text as, or `undefined` for a double-quoted text
// with an escape that JSON does not share; such a value is left alone.
function valueOfScalar(raw: string): string | undefined {
  if (raw.startsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  if (!raw.startsWith('"')) return raw;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Where the value of a key is in the lines of an item. */
interface Field {
  line: number;
  start: number;
  end: number;
}

// The value of `key` in the item, if the file has it as one scalar on the line
// of its key and it reads as `value`, so the writer knows it has the right
// bytes. A line further in after it would be part of the value, or of a
// mapping under the key, so such a value is not one the writer edits.
function fieldOf(
  item: Item,
  column: number,
  key: string,
  value: string,
): Field | undefined {
  const { lines, lead } = item;
  for (let i = lead; i < lines.length; i += 1) {
    const line = lines[i]!;
    const atColumn =
      i === lead || (!isFiller(line) && indentOf(line).length === column);
    const found = atColumn ? KEY.exec(line.text.slice(column)) : null;
    if (!found || (found[1] ?? found[2] ?? found[3]) !== key) continue;
    const span = scalarSpan(line.text, column + found[0].length);
    const next = lines.slice(i + 1).find((other) => !isFiller(other));
    const continues = next && indentOf(next).length > column;
    if (!span || continues) return undefined;
    const raw = line.text.slice(span.start, span.end);
    return valueOfScalar(raw) === value ? { line: i, ...span } : undefined;
  }
  return undefined;
}

// The lines of an item with the values of the keys that changed replaced, and
// every other byte as it was. The reason when one of them is not in a form
// that the writer edits in place.
function edited(
  item: Item,
  before: StageView,
  after: StageView,
): Line[] | string {
  if (sameStage(before, after)) return item.lines;
  const column = columnOf(item);
  if (column === undefined) return CANNOT_EDIT.stage(before.name);
  const lines = [...item.lines];
  for (const key of ['name', 'agent'] as const) {
    if (before[key] === after[key]) continue;
    const field = fieldOf(item, column, key, before[key]);
    if (!field) return CANNOT_EDIT.value(key, before.name);
    const line = lines[field.line]!;
    const text = `${line.text.slice(0, field.start)}${scalar(after[key])}${line.text.slice(field.end)}`;
    lines[field.line] = { ...line, text };
  }
  return lines;
}

// Where the block of stages is in `lines`, or `undefined` when the file has no
// `stages:` key of the block form at the top level. `next` is the line of the
// next top-level key, or the end of the file.
function blockIn(lines: Line[]): { key: number; next: number } | undefined {
  const key = lines.findIndex((line, i) =>
    STAGES_KEY.test(i === 0 ? line.text.replace(BOM, '') : line.text),
  );
  if (key < 0) return undefined;
  const next = lines.findIndex(
    (line, i) => i > key && NEXT_KEY.test(line.text),
  );
  return { key, next: next < 0 ? lines.length : next };
}

// The block of stages of a file, as far as the writer can edit it in place.
interface Plan {
  lines: Line[];
  key: number;
  next: number;
  layout: Layout;
  items: Item[];
  rest: Line[];
}

// The plan for a file whose view has `count` stages, or the reason the writer
// cannot change its stages in place.
function planFor(text: string, count: number): Plan | string {
  const lines = linesOf(text);
  const found = blockIn(lines);
  if (!found) return CANNOT_EDIT.notABlock;
  const block = lines.slice(found.key + 1, found.next);
  const layout = layoutOf(block);
  if (!layout) return CANNOT_EDIT.notABlock;
  if (layout.starts.length !== count) return CANNOT_EDIT.unmatched;
  return { lines, ...found, layout, ...itemsOf(block, layout) };
}

// The line break a line ends with. A new line takes the one of the `stages:`
// line. The last line of a block that ends the file ends it as the file did.
function breakOf(line: Line, last: boolean, eol: string, fileEnd?: string) {
  if (last && fileEnd !== undefined) return fileEnd;
  return line.made ? eol : line.eol || eol;
}

// Whether `stages` are the stages of the view, each where the view has it.
function unchanged(
  view: readonly StageView[],
  stages: readonly StageToWrite[],
): boolean {
  return (
    view.length === stages.length &&
    stages.every(
      (stage, i) =>
        (stage.from === undefined || stage.from === i) &&
        sameStage(stage, view[i]!),
    )
  );
}

// The lines of each stage in order: the file's own for a stage it has, with
// the values that changed replaced; the item of a deleted stage that matches
// a new one exactly, so deleting and adding back a stage changes nothing; and
// new lines for a stage the file does not have.
function bodyOf(
  plan: Plan,
  view: WorkflowView,
  stages: readonly StageToWrite[],
  eol: string,
): Line[] | string {
  const claimed = new Set(stages.map((stage) => stage.from));
  const unused = plan.items.flatMap((_, i) => (claimed.has(i) ? [] : [i]));
  const body: Line[] = [];
  for (const stage of stages) {
    if (stage.from !== undefined) {
      const item = plan.items[stage.from];
      const before = view.stages[stage.from];
      if (!item || !before) return CANNOT_EDIT.unmatched;
      const lines = edited(item, before, stage);
      if (typeof lines === 'string') return lines;
      body.push(...lines);
      continue;
    }
    const at = unused.findIndex((i) => sameStage(view.stages[i]!, stage));
    if (at < 0) {
      body.push(...generated(stage, eol, plan.layout.dash));
    } else {
      body.push(...plan.items[unused.splice(at, 1)[0]!]!.lines);
    }
  }
  return body;
}

/**
 * The text of the workflow with `stages` in place of its own, or the reason
 * the change cannot be written in place. A stage keeps every byte of its item
 * but the values of the keys that changed, so its other keys, such as
 * `prompt` and `prompt_file`, and its comments stay. A deleted stage takes
 * its item and the comments in front of it; a new stage is written with its
 * dashes where the file's own have them. Every byte outside the block of
 * stages stays: `format`, `version`, `params`, the comments and the line
 * endings. A file whose stages are not a list of items under a top-level key,
 * such as a list in the flow form, is never rewritten whole: the result says
 * why. The same goes for a stage or a value written in a form that cannot be
 * edited in place, when that stage or value changes.
 */
export function withStages(
  text: string,
  view: WorkflowView,
  stages: readonly StageToWrite[],
): Written {
  if (unchanged(view.stages, stages)) return { ok: true, text };
  const plan = planFor(text, view.stages.length);
  if (typeof plan === 'string') return { ok: false, reason: plan };
  const { lines, key, next, layout, rest } = plan;
  const eol = lines[key]!.eol || '\n';
  const body = bodyOf(plan, view, stages, eol);
  if (typeof body === 'string') return { ok: false, reason: body };
  const tail = [...rest, ...lines.slice(next)];
  const fileEnd = tail.length === 0 ? (lines.at(-1)?.eol ?? '') : undefined;
  const written = [...layout.head, ...body].map((line, i, all) => ({
    ...line,
    eol: breakOf(line, i === all.length - 1, eol, fileEnd),
  }));
  return {
    ok: true,
    text: [...lines.slice(0, key + 1), ...written, ...tail]
      .map((line) => line.text + line.eol)
      .join(''),
  };
}

/**
 * Why no change to the stages of `text` can be written in place, or
 * `undefined` when the file lays out its stages so that a change can be. A
 * single stage can still refuse a change of its own; see `withStages`.
 */
export function inPlaceBlocker(
  text: string,
  view: WorkflowView,
): string | undefined {
  const plan = planFor(text, view.stages.length);
  return typeof plan === 'string' ? plan : undefined;
}
