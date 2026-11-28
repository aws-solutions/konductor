// SPDX-License-Identifier: Apache-2.0
import { outputSpots, type OutputsSpot } from './outputs-spots';
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

/** The output-name error, if the value breaks the workflow contract. */
export function outputNameError(name: string): string | undefined {
  return OUTPUT_NAME.test(name) ? undefined : OUTPUT_NAME_ERROR;
}

const LAYOUT_REASON =
  'The outputs of this stage use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';
const COMMENTS_REASON =
  'The outputs of this stage contain comments, so adding or removing a row could move them. Change the rows in the YAML tab.';

interface Patch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
}

function renderFlow(outputs: readonly OutputToWrite[]): string {
  return `{${outputs.map(({ name, path }) => `${name}: ${scalar(path)}`).join(', ')}}`;
}

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

function replaceMap(
  spot: NonNullable<OutputsSpot['outputs']>,
  outputs: readonly OutputToWrite[],
  eol: string,
): Patch {
  if (spot.flow) {
    return { start: spot.start, end: spot.end, text: renderFlow(outputs) };
  }
  return {
    start: spot.start,
    end: spot.contentEnd,
    text:
      outputs.length === 0
        ? '{}'
        : outputs
            .map(
              ({ name, path }, index) =>
                `${index === 0 ? '' : spot.indent}${name}: ${scalar(path)}`,
            )
            .join(eol),
  };
}

function editMap(
  spot: NonNullable<OutputsSpot['outputs']>,
  outputs: readonly OutputToWrite[],
  eol: string,
): readonly Patch[] | string {
  if (spot.pairs.length !== outputs.length) {
    return spot.hasComments
      ? COMMENTS_REASON
      : [replaceMap(spot, outputs, eol)];
  }
  return outputs.flatMap((output, index) => {
    const before = spot.pairs[index]!;
    return [
      ...(before.name === output.name
        ? []
        : [{ start: before.key[0], end: before.key[1], text: output.name }]),
      ...(before.path === output.path
        ? []
        : [
            {
              start: before.value[0],
              end: before.value[1],
              text: scalar(output.path),
            },
          ]),
    ];
  });
}

function insertOutputs(
  text: string,
  spot: OutputsSpot,
  outputs: readonly OutputToWrite[],
  eol: string,
): Patch | string | undefined {
  if (outputs.length === 0) return undefined;
  if (spot.stageFlow && spot.stageClose !== undefined) {
    return {
      start: spot.stageClose,
      end: spot.stageClose,
      text: `, outputs: ${renderFlow(outputs)}`,
    };
  }
  if (spot.insertAt === undefined) return LAYOUT_REASON;
  const child = `${spot.keyIndent}  `;
  const prefix =
    spot.insertAt === text.length &&
    !text.endsWith('\n') &&
    !text.endsWith('\r')
      ? eol
      : '';
  return {
    start: spot.insertAt,
    end: spot.insertAt,
    text: `${prefix}${spot.keyIndent}outputs:${eol}${outputs
      .map(({ name, path }) => `${child}${name}: ${scalar(path)}${eol}`)
      .join('')}`,
  };
}

/** The file-wide reason stage outputs cannot be edited in place. */
export function outputsInPlaceBlocker(text: string): string | undefined {
  const spots = outputSpots(text);
  if (typeof spots === 'string') return spots;
  return spots.find((spot) => spot.reason)?.reason;
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
      const inserted = insertOutputs(text, spot, request.outputs, eol);
      if (typeof inserted === 'string') return { ok: false, reason: inserted };
      if (inserted) patches.push(inserted);
      continue;
    }
    const edited = editMap(spot.outputs, request.outputs, eol);
    if (typeof edited === 'string') return { ok: false, reason: edited };
    patches.push(...edited);
  }
  let result = text;
  for (const patch of patches.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, patch.start)}${patch.text}${result.slice(patch.end)}`;
  }
  return { ok: true, text: result };
}
