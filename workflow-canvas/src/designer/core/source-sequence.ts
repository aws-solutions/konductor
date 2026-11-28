// SPDX-License-Identifier: Apache-2.0
import { scalar } from './scalar-text';
import {
  afterLine,
  columnOf,
  eolOf,
  hasComment,
  isSeq,
  lineStart,
  textScalar,
  type SourcePatch,
} from './yaml-source';

export interface ScalarSequenceItem {
  readonly text: string;
  readonly range: readonly [number, number];
}

export interface ScalarSequenceSource {
  readonly flow: boolean;
  readonly close: number;
  readonly indent: string;
  readonly items: readonly ScalarSequenceItem[];
  readonly hasComments: boolean;
}

export interface SequencePatchResult {
  readonly patches?: readonly SourcePatch[];
  readonly structuralComment?: true;
}

export function scalarSequenceSource(
  text: string,
  value: unknown,
): ScalarSequenceSource | undefined {
  if (!isSeq(value) || !value.range || value.anchor || value.tag) {
    return undefined;
  }
  const items = value.items.map(textScalar);
  if (items.some((item) => item === undefined)) return undefined;
  return {
    flow: value.flow === true,
    close: value.range[1] - 1,
    indent: ' '.repeat(columnOf(text, value.range[0])),
    items: items as readonly ScalarSequenceItem[],
    hasComments:
      hasComment(value) || value.items.some((item) => hasComment(item)),
  };
}

/** Patches the smallest changed middle of a scalar sequence. */
export function scalarSequencePatches(
  text: string,
  source: ScalarSequenceSource,
  values: readonly string[],
): SequencePatchResult {
  const before = source.items.map(({ text }) => text);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < values.length &&
    before[prefix] === values[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < values.length - prefix &&
    before[before.length - 1 - suffix] === values[values.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = values.slice(prefix, values.length - suffix);
  const paired = Math.min(oldMiddle.length, newMiddle.length);
  const structural = oldMiddle.length !== newMiddle.length;
  if (structural && source.hasComments) return { structuralComment: true };
  const patches: SourcePatch[] = [];
  for (let index = 0; index < paired; index += 1) {
    const item = source.items[prefix + index]!;
    patches.push({
      start: item.range[0],
      end: item.range[1],
      text: scalar(newMiddle[index]!),
    });
  }
  const removed = oldMiddle.length - paired;
  if (removed > 0) {
    const first = prefix + paired;
    const last = first + removed - 1;
    const firstItem = source.items[first]!;
    const lastItem = source.items[last]!;
    const next = source.items[last + 1];
    if (source.items.length === removed) {
      const end = source.flow
        ? lastItem.range[1]
        : afterLine(text, lastItem.range[1]);
      const atEofWithoutBreak =
        !source.flow && end === text.length && !/[\r\n]$/.test(text);
      patches.push({
        start: source.flow
          ? firstItem.range[0]
          : lineStart(text, firstItem.range[0]),
        end,
        text: source.flow
          ? ''
          : `${source.indent}[]${atEofWithoutBreak ? '' : eolOf(text)}`,
      });
    } else if (source.flow) {
      patches.push(
        next
          ? { start: firstItem.range[0], end: next.range[0], text: '' }
          : {
              start: source.items[first - 1]!.range[1],
              end: lastItem.range[1],
              text: '',
            },
      );
    } else {
      patches.push({
        start: lineStart(text, firstItem.range[0]),
        end: afterLine(text, lastItem.range[1]),
        text: '',
      });
    }
  }
  const added = newMiddle.slice(paired).map(scalar);
  if (added.length > 0) {
    const next = source.items[prefix + paired];
    if (next) {
      patches.push({
        start: source.flow ? next.range[0] : lineStart(text, next.range[0]),
        end: source.flow ? next.range[0] : lineStart(text, next.range[0]),
        text: source.flow
          ? `${added.join(', ')}, `
          : added
              .map((value) => `${source.indent}- ${value}${eolOf(text)}`)
              .join(''),
      });
    } else if (source.items.length > 0) {
      const previous = source.items.at(-1)!;
      patches.push({
        start: previous.range[1],
        end: previous.range[1],
        text: source.flow
          ? `, ${added.join(', ')}`
          : `${eolOf(text)}${added.map((value) => `${source.indent}- ${value}`).join(eolOf(text))}`,
      });
    } else {
      patches.push({
        start: source.close,
        end: source.close,
        text: added.join(', '),
      });
    }
  }
  return { patches };
}
