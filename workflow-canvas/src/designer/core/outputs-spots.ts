// SPDX-License-Identifier: Apache-2.0
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Pair,
  type Scalar,
  type YAMLMap,
} from 'yaml';

/** One scalar output pair and its source ranges. */
export interface OutputPairSpot {
  readonly name: string;
  readonly path: string;
  readonly key: readonly [number, number];
  readonly value: readonly [number, number];
}

/** The source ranges needed to edit one stage's outputs. */
export interface OutputsSpot {
  readonly stageFlow: boolean;
  readonly stageClose?: number;
  readonly insertAt?: number;
  readonly keyIndent: string;
  readonly outputs?: {
    readonly flow: boolean;
    readonly start: number;
    readonly end: number;
    readonly contentEnd: number;
    readonly indent: string;
    readonly pairs: readonly OutputPairSpot[];
    readonly hasComments: boolean;
  };
  readonly reason?: string;
}

const LAYOUT_REASON =
  'The outputs of this stage use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';
const METADATA_REASON =
  'The outputs of this stage use an anchor, alias or tag, so the editor cannot change them safely. Change them in the YAML tab.';
const DUPLICATE_REASON =
  'The outputs of this stage contain a duplicate key, so the editor cannot change them safely. Change them in the YAML tab.';

const pairNamed = (pair: Pair, name: string) =>
  isScalar(pair.key) && pair.key.value === name;

function textScalar(node: unknown): node is Scalar<string> {
  return (
    isScalar(node) &&
    typeof node.value === 'string' &&
    node.range !== undefined &&
    node.range !== null &&
    node.anchor === undefined &&
    node.tag === undefined
  );
}

function columnOf(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && text[start - 1] !== '\n' && text[start - 1] !== '\r') {
    start -= 1;
  }
  return offset - start;
}

function afterLine(text: string, offset: number): number {
  let end = offset;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r')
    end += 1;
  if (text[end] === '\r' && text[end + 1] === '\n') return end + 2;
  return end < text.length ? end + 1 : end;
}

function endOf(pair: Pair | undefined): number {
  const key = pair?.key as Scalar | null | undefined;
  const value = pair?.value as Scalar | YAMLMap | null | undefined;
  return Math.max(key?.range?.[1] ?? 0, value?.range?.[1] ?? 0);
}

function outputMapSpot(
  text: string,
  pair: Pair,
): OutputsSpot['outputs'] | string {
  if (
    isAlias(pair.value) ||
    !isMap(pair.value) ||
    pair.value.anchor ||
    pair.value.tag
  ) {
    return METADATA_REASON;
  }
  const map = pair.value;
  if (!map.range) return LAYOUT_REASON;
  const names = new Set<string>();
  const pairs: OutputPairSpot[] = [];
  for (const item of map.items) {
    if (!textScalar(item.key) || !textScalar(item.value))
      return METADATA_REASON;
    if (names.has(item.key.value)) return DUPLICATE_REASON;
    names.add(item.key.value);
    const keyRange = item.key.range!;
    const valueRange = item.value.range!;
    pairs.push({
      name: item.key.value,
      path: item.value.value,
      key: [keyRange[0], keyRange[1]],
      value: [valueRange[0], valueRange[1]],
    });
  }
  const first = map.items[0]?.key as Scalar | null | undefined;
  const contentEnd = endOf(map.items.at(-1));
  const key = pair.key as Scalar | null | undefined;
  if (pairs.length > 0 && (!first?.range || contentEnd === 0))
    return LAYOUT_REASON;
  return {
    flow: map.flow === true,
    start: map.range[0],
    end: map.range[1],
    contentEnd,
    indent: first?.range ? ' '.repeat(columnOf(text, first.range[0])) : '',
    pairs,
    hasComments:
      key?.range !== undefined &&
      key.range !== null &&
      text.slice(key.range[1], map.range[1]).includes('#'),
  };
}

function stageSpot(text: string, stage: YAMLMap): OutputsSpot {
  if (!stage.range || stage.items.length === 0)
    return { stageFlow: false, keyIndent: '', reason: LAYOUT_REASON };
  const first = stage.items[0]?.key as Scalar | null | undefined;
  if (!first?.range)
    return { stageFlow: false, keyIndent: '', reason: LAYOUT_REASON };
  const keyIndent = ' '.repeat(columnOf(text, first.range[0]));
  const pairs = stage.items.filter((pair) => pairNamed(pair, 'outputs'));
  if (pairs.length > 1)
    return {
      stageFlow: stage.flow === true,
      keyIndent,
      reason: DUPLICATE_REASON,
    };
  const outputs = pairs[0] ? outputMapSpot(text, pairs[0]) : undefined;
  if (typeof outputs === 'string') {
    return { stageFlow: stage.flow === true, keyIndent, reason: outputs };
  }
  return {
    stageFlow: stage.flow === true,
    keyIndent,
    ...(stage.flow
      ? { stageClose: stage.range[1] - 1 }
      : { insertAt: afterLine(text, endOf(stage.items.at(-1))) }),
    ...(outputs ? { outputs } : {}),
  };
}

/** Finds source ranges for every stage's outputs, or why the file cannot be mapped. */
export function outputSpots(text: string): readonly OutputsSpot[] | string {
  const document = parseDocument(text, { uniqueKeys: false });
  if (document.errors.length > 0 || !isMap(document.contents))
    return LAYOUT_REASON;
  const roots = document.contents.items.filter((pair) =>
    pairNamed(pair, 'stages'),
  );
  if (roots.length !== 1 || !isSeq(roots[0]!.value)) return LAYOUT_REASON;
  const spots: OutputsSpot[] = [];
  for (const item of roots[0]!.value.items) {
    if (!isMap(item)) return LAYOUT_REASON;
    spots.push(stageSpot(text, item));
  }
  return spots;
}
