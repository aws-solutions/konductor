// SPDX-License-Identifier: Apache-2.0
import type { StageView, WorkflowView } from '../../api/types';

// A value that a plain YAML scalar reads back as the same text: it starts
// with a letter, has no character that YAML gives a meaning, and does not end
// in a space. `true`, `false` and `null` are left out, as they are not text.
const PLAIN = /^[A-Za-z](?:[A-Za-z0-9 _.,()/-]*[A-Za-z0-9_.,()/-])?$/;
const NOT_TEXT = /^(?:true|false|null)$/i;

// The value as YAML text: plain when that is safe, double-quoted if not.
function scalar(value: string): string {
  return PLAIN.test(value) && !NOT_TEXT.test(value)
    ? value
    : JSON.stringify(value);
}

function stageLines(stages: readonly StageView[]): string[] {
  return stages.flatMap((stage) => [
    `  - name: ${scalar(stage.name)}`,
    `    agent: ${scalar(stage.agent)}`,
  ]);
}

// The `stages:` key of the top level, with an optional comment after it.
const STAGES_KEY = /^stages:[ \t]*(?:#.*)?\r?$/;
// A line that starts the next top-level key or a document marker, which
// ends the block of stages. A `-` at the start is an item of the block.
const NEXT_KEY = /^(?:[^\s#-]|---|\.\.\.)/;
const BLANK_OR_COMMENT = /^(?:\s*|#.*)$/;

// The file's own line ending, so a file kept in CRLF stays in CRLF.
function endingOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// Swaps the block of stages of `text` for `stages`, and leaves every other
// byte alone. `undefined` when the text has no `stages:` key of the block form
// at the top level.
function replaceStageBlock(
  text: string,
  stages: readonly StageView[],
): string | undefined {
  const lines = text.split('\n');
  const key = lines.findIndex((line) => STAGES_KEY.test(line));
  if (key < 0) return undefined;
  const next = lines.findIndex(
    (line, index) => index > key && NEXT_KEY.test(line),
  );
  let end = next < 0 ? lines.length : next;
  // Blank lines and comments after the last stage belong to what follows.
  while (end > key + 1 && BLANK_OR_COMMENT.test(lines[end - 1] ?? '')) end -= 1;
  const tail = lines.slice(end);
  // A block that ends the file ends it without a line break, as it was.
  const cr = endingOf(text) === '\r\n' ? '\r' : '';
  const block = stageLines(stages).map((line, index, all) =>
    tail.length === 0 && index === all.length - 1 ? line : `${line}${cr}`,
  );
  return [...lines.slice(0, key + 1), ...block, ...tail].join('\n');
}

// A whole file written from the view: the layout that nothing else fits.
function writeWhole(view: WorkflowView, stages: readonly StageView[]): string {
  return [
    `name: ${scalar(view.name)}`,
    `intent: ${scalar(view.intent.outcome)}`,
    'stages:',
    ...stageLines(stages),
    '',
  ].join('\n');
}

/**
 * The text of the workflow with `stages` in place of its own. Only the block
 * of stages changes: the name, the intent, `version` and comments outside the
 * block stay as they are, and comments inside the block go with its old
 * stages. A file whose `stages` are not a block at the top level is written
 * whole from `view`, in the plain layout, which drops its comments and
 * `version`.
 */
export function withStages(
  text: string,
  view: WorkflowView,
  stages: readonly StageView[],
): string {
  return replaceStageBlock(text, stages) ?? writeWhole(view, stages);
}

/**
 * Whether a save of `text` would write the file whole, in the plain layout,
 * and so drop its comments and `version`: its `stages` are not a block at the
 * top level.
 */
export function willRewriteWhole(text: string): boolean {
  return replaceStageBlock(text, []) === undefined;
}
