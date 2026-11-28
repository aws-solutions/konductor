// SPDX-License-Identifier: Apache-2.0
import {
  outputSpots,
  type OutputPairSpot,
  type OutputsSpot,
} from './outputs-spots';
import { scalar } from './scalar-text';
import type { Written } from './stage-text';

/** One output declaration the editor asks the writer to keep. */
export interface OutputToWrite {
  readonly name: string;
  readonly path: string;
}

/** The outputs of one stage, with the declaration before the edit. */
export interface StageOutputsToWrite {
  readonly outputs: readonly OutputToWrite[];
  readonly before: Readonly<Record<string, string>>;
}

const OUTPUT_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/** The error shown when an output name breaks the workflow contract. */
export const OUTPUT_NAME_ERROR =
  'An output name must start with a lowercase letter and contain only lowercase letters, digits or hyphens, up to 64 characters.';
/** The refusal shown when two requested rows use one output name. */
export const OUTPUT_DUPLICATE_ERROR = 'Output names must be unique in a stage.';
export const OUTPUT_COMMENTS_REASON =
  'The outputs of this stage contain comments, so rows cannot be added or removed here. Change the rows in the YAML tab.';

/** The output-name error, if the value breaks the workflow contract. */
export function outputNameError(name: string): string | undefined {
  return OUTPUT_NAME.test(name) ? undefined : OUTPUT_NAME_ERROR;
}

const LAYOUT_REASON =
  'The outputs of this stage use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';

interface Patch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface Match {
  readonly current: number;
  readonly before: number;
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
}

const rowText = ({ name, path }: OutputToWrite) =>
  `${scalar(name)}: ${scalar(path)}`;

function same(
  outputs: readonly OutputToWrite[],
  before: Readonly<Record<string, string>>,
): boolean {
  const entries = Object.entries(before);
  return (
    entries.length === outputs.length &&
    outputs.every(
      (output, index) =>
        output.name === entries[index]?.[0] &&
        output.path === entries[index]?.[1],
    )
  );
}

function duplicateName(outputs: readonly OutputToWrite[]): boolean {
  return new Set(outputs.map(({ name }) => name)).size !== outputs.length;
}

function matchesOf(
  outputs: readonly OutputToWrite[],
  before: readonly (readonly [string, string])[],
): readonly Match[] {
  const matches: Match[] = [];
  const used = new Set<number>();
  for (const [current, output] of outputs.entries()) {
    const found = before.findIndex(
      ([name], index) => name === output.name && !used.has(index),
    );
    if (found >= 0) {
      used.add(found);
      matches.push({ current, before: found });
    }
  }
  const currentLeft = outputs
    .map((_, index) => index)
    .filter((index) => !matches.some((match) => match.current === index));
  const beforeLeft = before
    .map((_, index) => index)
    .filter((index) => !used.has(index));
  for (
    let index = 0;
    index < Math.min(currentLeft.length, beforeLeft.length);
    index += 1
  ) {
    matches.push({ current: currentLeft[index]!, before: beforeLeft[index]! });
  }
  return matches.sort((left, right) => left.current - right.current);
}

function editPatches(
  outputs: readonly OutputToWrite[],
  pairs: readonly OutputPairSpot[],
  matches: readonly Match[],
): Patch[] {
  return matches.flatMap(({ current, before }) => {
    const output = outputs[current]!;
    const pair = pairs[before]!;
    return [
      ...(output.name === pair.name
        ? []
        : [
            { start: pair.key[0], end: pair.key[1], text: scalar(output.name) },
          ]),
      ...(output.path === pair.path
        ? []
        : [
            {
              start: pair.value[0],
              end: pair.value[1],
              text: scalar(output.path),
            },
          ]),
    ];
  });
}

function groups(indices: readonly number[]): number[][] {
  const result: number[][] = [];
  for (const index of indices) {
    const group = result.at(-1);
    if (group?.at(-1) === index - 1) group.push(index);
    else result.push([index]);
  }
  return result;
}

function removalPatches(
  text: string,
  spot: NonNullable<OutputsSpot['outputs']>,
  matches: readonly Match[],
): Patch[] {
  const kept = new Set(matches.map(({ before }) => before));
  const removed = spot.pairs
    .map((_, index) => index)
    .filter((index) => !kept.has(index));
  if (removed.length === 0) return [];
  if (kept.size === 0) {
    return [
      {
        start: spot.pairs[0]!.key[0],
        end: spot.pairs.at(-1)!.value[1],
        text: spot.flow ? '' : '{}',
      },
    ];
  }
  return groups(removed).map((group) => {
    const first = group[0]!;
    const last = group.at(-1)!;
    if (spot.flow) {
      const next = spot.pairs[last + 1];
      if (next) {
        return {
          start: spot.pairs[first]!.key[0],
          end: next.key[0],
          text: '',
        };
      }
      const previous = spot.pairs[first - 1]!;
      return {
        start: previous.value[1],
        end: spot.pairs[last]!.value[1],
        text: '',
      };
    }
    const lastPair = spot.pairs[last]!;
    const atEof = lastPair.lineEnd === text.length && !/[\r\n]$/.test(text);
    if (atEof) {
      const previous = spot.pairs[first - 1]!;
      return {
        start: previous.value[1],
        end: lastPair.value[1],
        text: '',
      };
    }
    return {
      start: spot.pairs[first]!.lineStart,
      end: lastPair.lineEnd,
      text: '',
    };
  });
}

function insertionPatches(
  spot: NonNullable<OutputsSpot['outputs']>,
  outputs: readonly OutputToWrite[],
  matches: readonly Match[],
  eol: string,
): Patch[] {
  const matched = new Set(matches.map(({ current }) => current));
  const added = outputs
    .map((_, index) => index)
    .filter((index) => !matched.has(index));
  return groups(added).map((group) => {
    const rows = group.map((index) => rowText(outputs[index]!));
    const next = matches.find(({ current }) => current > group.at(-1)!);
    if (next) {
      const pair = spot.pairs[next.before]!;
      return spot.flow
        ? { start: pair.key[0], end: pair.key[0], text: `${rows.join(', ')}, ` }
        : {
            start: pair.lineStart,
            end: pair.lineStart,
            text: rows.map((row) => `${spot.indent}${row}${eol}`).join(''),
          };
    }
    const previous = [...matches]
      .reverse()
      .find(({ current }) => current < group[0]!);
    if (previous) {
      const pair = spot.pairs[previous.before]!;
      return {
        start: pair.value[1],
        end: pair.value[1],
        text: spot.flow
          ? `, ${rows.join(', ')}`
          : `${eol}${rows.map((row) => `${spot.indent}${row}`).join(eol)}`,
      };
    }
    return {
      start: spot.close,
      end: spot.close,
      text: rows.join(', '),
    };
  });
}

function editMap(
  text: string,
  spot: NonNullable<OutputsSpot['outputs']>,
  outputs: readonly OutputToWrite[],
  before: readonly (readonly [string, string])[],
  eol: string,
): readonly Patch[] | string {
  const matches = matchesOf(outputs, before);
  const structural =
    matches.length !== outputs.length || matches.length !== before.length;
  if (structural && spot.hasComments) return OUTPUT_COMMENTS_REASON;
  return [
    ...editPatches(outputs, spot.pairs, matches),
    ...removalPatches(text, spot, matches),
    ...insertionPatches(spot, outputs, matches, eol),
  ];
}

function insertOutputs(
  spot: OutputsSpot,
  outputs: readonly OutputToWrite[],
  eol: string,
): Patch | string | undefined {
  if (outputs.length === 0) return undefined;
  const rows = outputs.map(rowText);
  if (spot.stageFlow && spot.stageClose !== undefined) {
    return {
      start: spot.stageClose,
      end: spot.stageClose,
      text: `, outputs: {${rows.join(', ')}}`,
    };
  }
  if (spot.insertAt === undefined) return LAYOUT_REASON;
  const child = `${spot.keyIndent}  `;
  return {
    start: spot.insertAt,
    end: spot.insertAt,
    text: `${eol}${spot.keyIndent}outputs:${eol}${rows
      .map((row) => `${child}${row}`)
      .join(eol)}`,
  };
}

/** Why one stage's output controls cannot make the requested kind of edit. */
export function outputEditBlocker(
  text: string,
  stageIndex: number,
  structural = false,
): string | undefined {
  const spots = outputSpots(text);
  if (typeof spots === 'string') return spots;
  const spot = spots[stageIndex];
  if (!spot) return LAYOUT_REASON;
  return (
    spot.reason ??
    (structural && spot.outputs?.hasComments
      ? OUTPUT_COMMENTS_REASON
      : undefined)
  );
}

/** Writes output declarations by source range while preserving every other byte. */
export function withOutputs(
  text: string,
  requested: readonly StageOutputsToWrite[],
): Written {
  if (
    requested.some(({ outputs }) =>
      outputs.some(({ name }) => outputNameError(name)),
    )
  ) {
    return { ok: false, reason: OUTPUT_NAME_ERROR };
  }
  if (requested.some(({ outputs }) => duplicateName(outputs))) {
    return { ok: false, reason: OUTPUT_DUPLICATE_ERROR };
  }
  const spots = outputSpots(text);
  if (typeof spots === 'string' || spots.length !== requested.length) {
    return {
      ok: false,
      reason: typeof spots === 'string' ? spots : LAYOUT_REASON,
    };
  }
  const eol = eolOf(text);
  const patches: Patch[] = [];
  for (const [index, request] of requested.entries()) {
    if (same(request.outputs, request.before)) continue;
    const spot = spots[index]!;
    if (spot.reason) return { ok: false, reason: spot.reason };
    if (!spot.outputs) {
      const inserted = insertOutputs(spot, request.outputs, eol);
      if (typeof inserted === 'string') return { ok: false, reason: inserted };
      if (inserted) patches.push(inserted);
      continue;
    }
    const edited = editMap(
      text,
      spot.outputs,
      request.outputs,
      Object.entries(request.before),
      eol,
    );
    if (typeof edited === 'string') return { ok: false, reason: edited };
    patches.push(...edited);
  }
  let result = text;
  for (const patch of patches.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, patch.start)}${patch.text}${result.slice(patch.end)}`;
  }
  return { ok: true, text: result };
}
