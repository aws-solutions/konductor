// SPDX-License-Identifier: Apache-2.0
import {
  outputSpots,
  type OutputPairSpot,
  type OutputsSpot,
} from './outputs-spots';
import { scalar } from './scalar-text';
import {
  sourceRowMatches,
  sourceRowPatches,
  type SourceRowMatch,
} from './source-rows';
import {
  applyPatches,
  columnOf,
  eolOf,
  insertMapPair,
  textScalar,
  type SourcePatch,
} from './yaml-source';
import type { Written } from './stage-text';

export interface OutputToWrite {
  readonly name: string;
  readonly path: string;
  /** Source-row index; absent for a newly added row. */
  readonly source?: number;
}

export interface StageOutputsToWrite {
  readonly outputs: readonly OutputToWrite[];
  readonly before: Readonly<Record<string, string>>;
}

const OUTPUT_NAME = /^[a-z][a-z0-9-]{0,63}$/;
export const OUTPUT_NAME_ERROR =
  'An output name must start with a lowercase letter and contain only lowercase letters, digits or hyphens, up to 64 characters.';
export const OUTPUT_DUPLICATE_ERROR = 'Output names must be unique in a stage.';
export const OUTPUT_ORDER_ERROR = 'Output rows cannot be reordered here.';
export const OUTPUT_COMMENTS_REASON =
  'The outputs of this stage contain comments, so rows cannot be added or removed here. Change the rows in the YAML tab.';

export function outputNameError(name: string): string | undefined {
  return OUTPUT_NAME.test(name) ? undefined : OUTPUT_NAME_ERROR;
}

const LAYOUT_REASON =
  'The outputs of this stage use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';

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

function editPatches(
  outputs: readonly OutputToWrite[],
  pairs: readonly OutputPairSpot[],
  matches: readonly SourceRowMatch[],
): SourcePatch[] {
  return matches.flatMap(({ current, source }) => {
    const output = outputs[current]!;
    const pair = pairs[source]!;
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

function editMap(
  text: string,
  spot: NonNullable<OutputsSpot['outputs']>,
  outputs: readonly OutputToWrite[],
  before: readonly (readonly [string, string])[],
): readonly SourcePatch[] | string {
  const matches = sourceRowMatches(
    before.length,
    outputs.map(({ source }) => source),
  );
  if (!matches) return LAYOUT_REASON;
  const sourceOrder = matches.map(({ source }) => source);
  if (
    sourceOrder.some(
      (source, index) => index > 0 && source < sourceOrder[index - 1]!,
    )
  ) {
    return OUTPUT_ORDER_ERROR;
  }
  const structural = sourceRowPatches({
    text,
    source: spot,
    matches,
    currentCount: outputs.length,
    render: (current) => rowText(outputs[current]!),
    commentReason: OUTPUT_COMMENTS_REASON,
  });
  if (typeof structural === 'string') return structural;
  return [...editPatches(outputs, spot.rows, matches), ...structural];
}

function insertOutputs(
  text: string,
  spot: OutputsSpot,
  outputs: readonly OutputToWrite[],
): SourcePatch | string | undefined {
  if (outputs.length === 0) return undefined;
  if (spot.stage.flow && spot.stageHasComments) return OUTPUT_COMMENTS_REASON;
  const eol = eolOf(text);
  const rows = outputs.map(rowText);
  const first = textScalar(spot.stage.items[0]?.key);
  if (!first) return LAYOUT_REASON;
  const indent = ' '.repeat(columnOf(text, first.range[0]));
  const value = spot.stage.flow
    ? `{${rows.join(', ')}}`
    : `${eol}${rows.map((row) => `${indent}  ${row}`).join(eol)}`;
  return insertMapPair(text, spot.stage, 'outputs', value) ?? LAYOUT_REASON;
}

export function outputEditBlocker(
  text: string,
  stageIndex: number,
  structural = false,
): string | undefined {
  const spots = outputSpots(text);
  if (typeof spots === 'string') return spots;
  const spot = spots[stageIndex];
  if (!spot) return LAYOUT_REASON;
  if (spot.reason) return spot.reason;
  if (
    structural &&
    (spot.outputs?.hasComments || (spot.stage.flow && spot.stageHasComments))
  ) {
    return OUTPUT_COMMENTS_REASON;
  }
  return undefined;
}

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
  const patches: SourcePatch[] = [];
  for (const [index, request] of requested.entries()) {
    if (same(request.outputs, request.before)) continue;
    const spot = spots[index]!;
    if (spot.reason) return { ok: false, reason: spot.reason };
    if (!spot.outputs) {
      const inserted = insertOutputs(text, spot, request.outputs);
      if (typeof inserted === 'string') return { ok: false, reason: inserted };
      if (inserted) patches.push(inserted);
      continue;
    }
    const edited = editMap(
      text,
      spot.outputs,
      request.outputs,
      Object.entries(request.before),
    );
    if (typeof edited === 'string') return { ok: false, reason: edited };
    patches.push(...edited);
  }
  return { ok: true, text: applyPatches(text, patches) };
}
