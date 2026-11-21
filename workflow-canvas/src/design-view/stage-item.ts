// SPDX-License-Identifier: Apache-2.0
import type { CheckViewStage } from '../designer-view/yaml-draft';

/** The first and last line a stage takes up, counted from 1. */
interface Lines {
  readonly first: number;
  readonly last: number;
}

/** One line of a file and the break that ends it, empty at the end of one. */
interface Line {
  readonly text: string;
  readonly eol: string;
}

// `\r\n`, `\n` and a lone `\r` all end a line, as they do for the writer.
function brokenLinesOf(text: string): Line[] {
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
// The `stages:` key of the top level, quoted or not, with an optional
// comment. The writer finds the block by this same line.
const STAGES_KEY = /^(?:stages|"stages"|'stages'):[ \t]*(?:#.*)?$/;

/**
 * The break that the writer would end a line of its own with: the one of the
 * `stages:` key, or `\n` when that key ends the file. `undefined` for a file
 * with no such key, which the writer writes whole rather than in place.
 */
function keyBreakOf(lines: readonly Line[]): string | undefined {
  const key = lines.find((line, index) =>
    STAGES_KEY.test(index === 0 ? line.text.replace(BOM, '') : line.text),
  );
  return key === undefined ? undefined : key.eol || '\n';
}

function linesOf(stage: CheckViewStage | undefined): Lines | undefined {
  const range = stage?.range;
  if (typeof range !== 'object' || range === null) return undefined;
  const { line, end_line: endLine } = range as Record<string, unknown>;
  if (!Number.isInteger(line) || !Number.isInteger(endLine)) return undefined;
  const first = line as number;
  const last = endLine as number;
  return first >= 1 && last >= first ? { first, last } : undefined;
}

/**
 * The bytes of a file that a stage takes up, as the check says, or
 * `undefined` when the stage has no range this page can read. The break that
 * ends each of those lines is part of them, because a save that writes
 * another break there has changed the file; the last line of a file that
 * ends without one brings none.
 */
export function itemTextOf(
  text: string,
  stage: CheckViewStage | undefined,
): string | undefined {
  const at = linesOf(stage);
  if (at === undefined) return undefined;
  const lines = brokenLinesOf(text);
  if (at.last > lines.length) return undefined;
  return lines
    .slice(at.first - 1, at.last)
    .map((line) => line.text + line.eol)
    .join('');
}

/**
 * Whether the stage writer of the editor would write this item of the file
 * back as the file has it, when only the name or the agent of the stage
 * changes.
 *
 * The writer keeps the lines of a stage it did not change, and writes a stage
 * it did change as two lines of its own: the name and the agent, each a plain
 * scalar, with the agent indented two spaces past the dash, each ended with
 * `eol`, the break of the `stages:` key. So an item that is already exactly
 * those two lines, for the name and the agent the file holds, and ended the
 * way the writer ends them, loses nothing. Anything else in it goes: a
 * comment inside the item, a blank line, another key, a quoted or folded
 * value, the two keys the other way round, a value written on a line of its
 * own, or a break that is not the one the key has, the missing break at the
 * end of a file included.
 */
export function writerKeepsItem(
  item: string | undefined,
  name: string,
  agent: string,
  /** The break the writer ends a line it writes with. */
  eol: string,
): boolean {
  if (item === undefined) return false;
  const lines = brokenLinesOf(item);
  if (lines.length !== 2) return false;
  const dash = /^([ \t]*)- name: (.*)$/.exec(lines[0]?.text ?? '');
  if (!dash || dash[2] !== name) return false;
  if (lines[1]?.text !== `${dash[1]}  agent: ${agent}`) return false;
  return lines.every((line) => line.eol === eol);
}

/**
 * Whether a save would write the stage at `index` back as the file has it,
 * when only its name or its agent changes. `stages` are the stages of the
 * file as the check gives them, in the order of the file.
 *
 * Besides the lines of the stage itself, the lines between it and the stage
 * before it count: the writer reads a comment or a blank line there as part
 * of the stage that follows it, so they go when that stage is written again.
 * The lines in front of the first stage are the head of the list, which the
 * writer keeps whatever it does with the stages. The breaks count too: the
 * writer ends a line it writes with the break of the `stages:` key, so a
 * stage whose own breaks differ from it is written with other bytes.
 *
 * None of this is in the parsed stage the check gives, so the lines of the
 * file are the only place it can be seen.
 */
export function writerKeepsStage(
  text: string,
  stages: readonly CheckViewStage[],
  index: number,
): boolean {
  const stage = stages[index];
  const at = linesOf(stage);
  if (stage === undefined || at === undefined) return false;
  const eol = keyBreakOf(brokenLinesOf(text));
  if (eol === undefined) return false;
  const name = typeof stage.name === 'string' ? stage.name : '';
  const agent = typeof stage.agent === 'string' ? stage.agent : '';
  if (!writerKeepsItem(itemTextOf(text, stage), name, agent, eol)) return false;
  if (index === 0) return true;
  const before = linesOf(stages[index - 1]);
  // A stage whose place in the file cannot be told from the one before it
  // may have anything between them.
  return before !== undefined && before.last === at.first - 1;
}
