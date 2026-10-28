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
const BLANK_OR_COMMENT = /^\s*(?:#.*)?$/;
const ITEM_START = /^[ \t]*-(?:[ \t]|$)/;
// Where the dashes go in a list that has no item yet.
const DEFAULT_DASH = '  ';

const isFiller = (line: Line) => BLANK_OR_COMMENT.test(line.text);
const indentOf = (line: Line) => /^[ \t]*/.exec(line.text)![0];

// A stage as the file wrote it: the lines of its item, with the comments and
// blank lines in front of it.
interface Item {
  stage: StageView;
  lines: Line[];
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

// Splits the lines after the head at the start of each item. Comments and
// blank lines between two items go with the one after them. Empty when the
// items cannot be matched one to one with `stages`.
function itemsOf(
  block: Line[],
  { starts }: Layout,
  stages: readonly StageView[],
): Item[] {
  if (starts.length !== stages.length) return [];
  let lead: Line[] = [];
  return starts.map((start, n) => {
    const body = block.slice(start, starts[n + 1] ?? block.length);
    let cut = body.length;
    while (cut > 1 && isFiller(body[cut - 1]!)) cut -= 1;
    const item = { stage: stages[n]!, lines: [...lead, ...body.slice(0, cut)] };
    lead = body.slice(cut);
    return item;
  });
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

// The lines of `stage`: the file's own for a stage that is unchanged, so its
// comments and layout stay, and new ones for a stage that is new or changed.
function linesOfStage(
  stage: StageView,
  unused: Item[],
  eol: string,
  dash: string,
): Line[] {
  const at = unused.findIndex((item) => sameStage(item.stage, stage));
  return at < 0 ? generated(stage, eol, dash) : unused.splice(at, 1)[0]!.lines;
}

// Where the block of stages is in `lines`, or `undefined` when the file has no
// `stages:` key of the block form at the top level. `end` stops before the
// comments and blank lines that trail the last stage.
function blockIn(lines: Line[]): { key: number; end: number } | undefined {
  const key = lines.findIndex((line, i) =>
    STAGES_KEY.test(i === 0 ? line.text.replace(BOM, '') : line.text),
  );
  if (key < 0) return undefined;
  const next = lines.findIndex(
    (line, i) => i > key && NEXT_KEY.test(line.text),
  );
  let end = next < 0 ? lines.length : next;
  while (end > key + 1 && isFiller(lines[end - 1]!)) end -= 1;
  return { key, end };
}

// The block of stages of a file, as far as the writer can edit it in place.
interface Plan {
  lines: Line[];
  key: number;
  end: number;
  block: Line[];
  layout: Layout;
}

function planFor(text: string): Plan | undefined {
  const lines = linesOf(text);
  const found = blockIn(lines);
  if (!found) return undefined;
  const block = lines.slice(found.key + 1, found.end);
  const layout = layoutOf(block);
  return layout && { lines, ...found, block, layout };
}

// The line break a line ends with. A new line takes the one of the `stages:`
// line. The last line of a block that ends the file ends it as the file did.
function breakOf(line: Line, last: boolean, eol: string, fileEnd?: string) {
  if (last && fileEnd !== undefined) return fileEnd;
  return line.made ? eol : line.eol || eol;
}

// Swaps the block of stages of `text` for `stages`, and leaves every other
// byte alone. `undefined` when the stages are not a block that new items can
// join: no `stages:` key of the block form at the top level, or a list of
// another form.
function replaceStageBlock(
  text: string,
  view: WorkflowView,
  stages: readonly StageView[],
): string | undefined {
  const plan = planFor(text);
  if (!plan) return undefined;
  const { lines, key, end, block, layout } = plan;
  const unused = itemsOf(block, layout, view.stages);
  const eol = lines[key]!.eol || '\n';
  const body = stages.flatMap((stage) =>
    linesOfStage(stage, unused, eol, layout.dash),
  );
  const tail = lines.slice(end);
  const fileEnd = tail.length === 0 ? (lines[end - 1]?.eol ?? '') : undefined;
  const written = [...layout.head, ...body].map((line, i, all) => ({
    ...line,
    eol: breakOf(line, i === all.length - 1, eol, fileEnd),
  }));
  return [...lines.slice(0, key + 1), ...written, ...tail]
    .map((line) => line.text + line.eol)
    .join('');
}

// A whole file written from the view: the layout that nothing else fits.
function writeWhole(view: WorkflowView, stages: readonly StageView[]): string {
  const lines = stages.flatMap((stage) => generated(stage, '\n', DEFAULT_DASH));
  return [
    `name: ${scalar(view.name)}`,
    `intent: ${scalar(view.intent.outcome)}`,
    'stages:',
    ...lines.map((line) => line.text),
    '',
  ].join('\n');
}

/**
 * The text of the workflow with `stages` in place of its own. Only the block
 * of stages changes: the name, the intent, `version`, the line endings and the
 * comments outside the block stay as they are. A stage that is unchanged keeps
 * its own lines, with the comments in front of it; a stage that is new or
 * changed is written with its dashes where the file's own have them, and the
 * comments written inside a stage that is changed or deleted go with it. A
 * file whose `stages` are not a list of items under a top-level key, such as
 * a list in the flow form, is written whole from `view`, in the plain layout,
 * which drops its comments and `version`.
 */
export function withStages(
  text: string,
  view: WorkflowView,
  stages: readonly StageView[],
): string {
  return replaceStageBlock(text, view, stages) ?? writeWhole(view, stages);
}

/**
 * Whether a save of `text` would write the file whole, in the plain layout,
 * and so drop its comments and `version`: its `stages` are not a list of items
 * under a top-level key.
 */
export function willRewriteWhole(text: string): boolean {
  return planFor(text) === undefined;
}
