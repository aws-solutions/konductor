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

// A value that a plain YAML scalar reads back as the same text, and the words
// YAML 1.1 reads as booleans or null, which are left out of it.
const PLAIN = /^[A-Za-z](?:[A-Za-z0-9 _.,()/-]*[A-Za-z0-9_.,()/-])?$/;
const NOT_TEXT = /^(?:true|false|null|y|n|yes|no|on|off)$/i;

/**
 * A value as the writer writes it: plain where that reads back as the same
 * text, double-quoted where it would not.
 *
 * This is a copy of the writer's own encoder, which it does not export, and
 * the only thing here that says what the bytes of a line it writes are. A
 * copy can drift, so writer-contract.test.ts holds this one to the writer
 * value by value, through what `withStages` actually writes.
 */
export function writerScalar(value: string): string {
  return PLAIN.test(value) && !NOT_TEXT.test(value)
    ? value
    : JSON.stringify(value);
}

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
 * it did change as two lines of its own: the name and the agent as
 * `writerScalar` writes them, with the agent indented two spaces past the
 * dash, each ended with `eol`, the break of the `stages:` key. So an item
 * that is already exactly those two lines, for the name and the agent the
 * file holds, loses nothing. Anything else in it goes: a comment inside the
 * item, a blank line, another key, the two keys the other way round, a value
 * written on a line of its own, a break that is not the one the key has, the
 * missing break at the end of a file included, or a value written in any
 * other way than the writer would write it, such as a plain `yes`, which the
 * writer quotes to keep it from reading as a boolean.
 */
export function writerKeepsItem(
  item: string | undefined,
  name: string,
  agent: string,
  /** The break the writer ends a line it writes with. */
  eol: string,
): boolean {
  return itemRefusal(item, name, agent, eol) === undefined;
}

/**
 * What the lines of the stage hold that the writer would not write back, as
 * a phrase to put after "so it is refused:", or `undefined` when the writer
 * would keep them. It names one thing, the first it finds, so a person is
 * told what to look for rather than the whole list of what it could be.
 */
export function itemRefusal(
  item: string | undefined,
  name: string,
  agent: string,
  /** The break the writer ends a line it writes with. */
  eol: string,
): string | undefined {
  if (item === undefined) return 'lines this page cannot read';
  const lines = brokenLinesOf(item);
  if (lines.length !== 2) {
    return lines.length > 2
      ? 'a comment, a blank line or another key inside it'
      : 'fewer lines than the name and the agent take';
  }
  const first = lines[0]?.text ?? '';
  const dash = /^([ \t]*)- name: (.*)$/.exec(first);
  if (!dash) {
    const other = /^[ \t]*- ([^:]+):/.exec(first);
    return other
      ? `${other[1]} written before name`
      : 'a first line the writer would not write';
  }
  if (dash[2] !== writerScalar(name)) {
    return `the name written as ${dash[2]}, not as ${writerScalar(name)}`;
  }
  const agentLine = `${dash[1]}  agent: ${writerScalar(agent)}`;
  if (lines[1]?.text !== agentLine) {
    return `the agent written as ${(lines[1]?.text ?? '').trim()}, not as ${agentLine.trim()}`;
  }
  if (lines.some((line) => line.eol === '')) {
    return 'no line break at the end of the file';
  }
  return lines.every((line) => line.eol === eol)
    ? undefined
    : 'line breaks that are not the ones of the stages: key';
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
  return stageRefusal(text, stages, index) === undefined;
}

/**
 * What a save of the stage at `index` would lose, as a phrase to put after
 * "so it is refused:", or `undefined` when it would lose nothing. It names
 * the first thing it finds, so the message says what to look for in the
 * file, inside the stage or in front of it, rather than listing everything
 * it could have been.
 */
export function stageRefusal(
  text: string,
  stages: readonly CheckViewStage[],
  index: number,
): string | undefined {
  const stage = stages[index];
  const at = linesOf(stage);
  if (stage === undefined || at === undefined) {
    return 'lines this page cannot read';
  }
  const eol = keyBreakOf(brokenLinesOf(text));
  if (eol === undefined) return 'no stages: key the writer can write under';
  const name = typeof stage.name === 'string' ? stage.name : '';
  const agent = typeof stage.agent === 'string' ? stage.agent : '';
  const inside = itemRefusal(itemTextOf(text, stage), name, agent, eol);
  if (inside !== undefined) return inside;
  if (index === 0) return undefined;
  const before = linesOf(stages[index - 1]);
  // A stage whose place in the file cannot be told from the one before it
  // may have anything between them.
  if (before === undefined) return 'lines this page cannot read';
  return before.last === at.first - 1
    ? undefined
    : 'a comment or a blank line in front of it';
}
