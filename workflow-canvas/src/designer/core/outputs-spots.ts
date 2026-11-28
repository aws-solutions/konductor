// SPDX-License-Identifier: Apache-2.0
import type { SourceRow, SourceRows } from './source-rows';
import {
  afterLine,
  columnOf,
  hasComment,
  isAlias,
  isMap,
  isSeq,
  lineStart,
  pairNamed,
  parseDocument,
  textScalar,
  type Pair,
  type YAMLMap,
} from './yaml-source';

export interface OutputPairSpot extends SourceRow {
  readonly name: string;
  readonly path: string;
  readonly key: readonly [number, number];
  readonly value: readonly [number, number];
}

export interface OutputsSpot {
  readonly stage: YAMLMap;
  readonly outputs?: SourceRows & {
    readonly rows: readonly OutputPairSpot[];
  };
  readonly stageHasComments: boolean;
  readonly reason?: string;
}

const LAYOUT_REASON =
  'The outputs of this stage use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';
const METADATA_REASON =
  'The outputs of this stage use an anchor, alias or tag, so the editor cannot change them safely. Change them in the YAML tab.';
const DUPLICATE_REASON =
  'The outputs of this stage contain a duplicate key, so the editor cannot change them safely. Change them in the YAML tab.';

function outputMapSpot(
  text: string,
  pair: Pair,
): OutputsSpot['outputs'] | string {
  if (
    isAlias(pair.value) ||
    !isMap(pair.value) ||
    pair.value.anchor ||
    pair.value.tag ||
    !pair.value.range
  ) {
    return METADATA_REASON;
  }
  const names = new Set<string>();
  const pairs: OutputPairSpot[] = [];
  for (const item of pair.value.items) {
    const key = textScalar(item.key);
    const value = textScalar(item.value);
    if (!key || !value) return METADATA_REASON;
    if (names.has(key.text)) return DUPLICATE_REASON;
    names.add(key.text);
    pairs.push({
      name: key.text,
      path: value.text,
      key: key.range,
      value: value.range,
      start: key.range[0],
      contentEnd: value.range[1],
      lineStart: lineStart(text, key.range[0]),
      lineEnd: afterLine(text, value.range[1]),
    });
  }
  const first = pairs[0];
  return {
    flow: pair.value.flow === true,
    close: pair.value.range[1] - 1,
    indent: first ? ' '.repeat(columnOf(text, first.key[0])) : '',
    rows: pairs,
    hasComments:
      hasComment(pair.key) ||
      hasComment(pair.value) ||
      pair.value.items.some(
        (item) =>
          hasComment(item) || hasComment(item.key) || hasComment(item.value),
      ),
  };
}

function stageSpot(text: string, stage: YAMLMap): OutputsSpot {
  const pairs = stage.items.filter((pair) => pairNamed(pair, 'outputs'));
  if (pairs.length > 1) {
    return { stage, stageHasComments: false, reason: DUPLICATE_REASON };
  }
  const outputs = pairs[0] ? outputMapSpot(text, pairs[0]) : undefined;
  if (typeof outputs === 'string') {
    return { stage, stageHasComments: false, reason: outputs };
  }
  const last = stage.items.at(-1);
  return {
    stage,
    ...(outputs ? { outputs } : {}),
    stageHasComments:
      hasComment(stage) ||
      (!!last &&
        (hasComment(last) || hasComment(last.key) || hasComment(last.value))),
  };
}

/** Finds output source ranges for every stage. */
export function outputSpots(text: string): readonly OutputsSpot[] | string {
  const document = parseDocument(text, { uniqueKeys: false });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return LAYOUT_REASON;
  }
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
