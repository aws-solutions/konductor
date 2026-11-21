// SPDX-License-Identifier: Apache-2.0
import type { CheckViewStage } from '../designer-view/yaml-draft';

/** The first and last line a stage takes up, counted from 1. */
interface Lines {
  readonly first: number;
  readonly last: number;
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
 * The lines of a file that a stage takes up, as the check says, or
 * `undefined` when the stage has no range this page can read.
 */
export function itemTextOf(
  text: string,
  stage: CheckViewStage | undefined,
): string | undefined {
  const at = linesOf(stage);
  if (at === undefined) return undefined;
  const lines = text.split(/\r\n|\r|\n/);
  if (at.last > lines.length) return undefined;
  return lines.slice(at.first - 1, at.last).join('\n');
}

/**
 * Whether the stage writer of the editor would write this item of the file
 * back as the file has it, when only the name or the agent of the stage
 * changes.
 *
 * The writer keeps the lines of a stage it did not change, and writes a stage
 * it did change as two lines of its own: the name and the agent, each a plain
 * scalar, with the agent indented two spaces past the dash. So an item that is
 * already exactly those two lines, for the name and the agent the file holds,
 * loses nothing. Anything else in it goes: a comment inside the item, a blank
 * line, another key, a quoted or folded value, the two keys the other way
 * round, or a value written on a line of its own.
 */
export function writerKeepsItem(
  item: string | undefined,
  name: string,
  agent: string,
): boolean {
  if (item === undefined) return false;
  const lines = item.split('\n');
  if (lines.length !== 2) return false;
  const dash = /^([ \t]*)- name: (.*)$/.exec(lines[0] ?? '');
  if (!dash || dash[2] !== name) return false;
  return lines[1] === `${dash[1]}  agent: ${agent}`;
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
 * writer keeps whatever it does with the stages.
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
  const name = typeof stage.name === 'string' ? stage.name : '';
  const agent = typeof stage.agent === 'string' ? stage.agent : '';
  if (!writerKeepsItem(itemTextOf(text, stage), name, agent)) return false;
  if (index === 0) return true;
  const before = linesOf(stages[index - 1]);
  // A stage whose place in the file cannot be told from the one before it
  // may have anything between them.
  return before !== undefined && before.last === at.first - 1;
}
