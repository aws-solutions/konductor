// SPDX-License-Identifier: Apache-2.0
import { scalar } from './scalar-text';
import {
  scalarSequencePatches,
  scalarSequenceSource,
  type ScalarSequenceSource,
} from './source-sequence';
import type { Written } from './stage-text';
import {
  applyPatches,
  hasComment,
  hasMapComments,
  insertMapPair,
  isMap,
  isSeq,
  parseDocument,
  uniquePair,
  type SourcePatch,
  type YAMLMap,
} from './yaml-source';
import { CHECK_COMMENTS_REASON } from './checks-spots';

export const CHECK_REFERENCE_ERROR =
  'Every done_when id must name a declared acceptance check.';

const LAYOUT =
  'The checks use a layout the editor cannot keep byte for byte. Change them in the YAML tab.';
const METADATA =
  'The checks use an anchor, alias or tag, so the editor cannot change them safely. Change them in the YAML tab.';
const DUPLICATE_SOURCE =
  'The checks contain a duplicate key, so the editor cannot change them safely. Change them in the YAML tab.';

interface DoneWhenSpot {
  readonly map: YAMLMap;
  readonly source?: ScalarSequenceSource;
  readonly reason?: string;
}

export interface DoneWhenRequest {
  readonly values: readonly string[];
  readonly before: readonly string[];
}

function doneWhenSpot(text: string, map: YAMLMap): DoneWhenSpot {
  const pair = uniquePair(map, 'done_when');
  if (pair === 'duplicate') return { map, reason: DUPLICATE_SOURCE };
  if (!pair) return { map };
  const sequence = scalarSequenceSource(text, pair.value);
  if (!sequence) return { map, reason: METADATA };
  return {
    map,
    source: {
      ...sequence,
      hasComments:
        hasComment(pair.key) || hasComment(pair.value) || sequence.hasComments,
    },
  };
}

function doneWhenSpots(text: string): readonly DoneWhenSpot[] | string {
  const document = parseDocument(text, { uniqueKeys: false });
  if (document.errors.length > 0 || !isMap(document.contents)) return LAYOUT;
  const stagesPair = uniquePair(document.contents, 'stages');
  if (stagesPair === 'duplicate') return DUPLICATE_SOURCE;
  if (!stagesPair || !isSeq(stagesPair.value)) return LAYOUT;
  const spots: DoneWhenSpot[] = [];
  for (const stage of stagesPair.value.items) {
    if (!isMap(stage)) return LAYOUT;
    spots.push(doneWhenSpot(text, stage));
  }
  return spots;
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function insertionPatch(
  text: string,
  spot: DoneWhenSpot,
  values: readonly string[],
): SourcePatch | string | undefined {
  if (values.length === 0) return undefined;
  if (spot.map.flow && hasMapComments(spot.map)) return CHECK_COMMENTS_REASON;
  return (
    insertMapPair(
      text,
      spot.map,
      'done_when',
      `[${values.map(scalar).join(', ')}]`,
    ) ?? LAYOUT
  );
}

export function doneWhenEditBlocker(
  text: string,
  stageIndex: number,
): string | undefined {
  const spots = doneWhenSpots(text);
  if (typeof spots === 'string') return spots;
  const spot = spots[stageIndex];
  if (!spot) return LAYOUT;
  if (spot.reason) return spot.reason;
  if (spot.source?.hasComments) return CHECK_COMMENTS_REASON;
  return !spot.source && spot.map.flow && hasMapComments(spot.map)
    ? CHECK_COMMENTS_REASON
    : undefined;
}

export function withDoneWhen(
  text: string,
  requests: readonly DoneWhenRequest[],
  declaredIds: ReadonlySet<string>,
): Written {
  if (
    requests.some(({ values }) => values.some((id) => !declaredIds.has(id)))
  ) {
    return { ok: false, reason: CHECK_REFERENCE_ERROR };
  }
  const spots = doneWhenSpots(text);
  if (typeof spots === 'string' || spots.length !== requests.length) {
    return {
      ok: false,
      reason: typeof spots === 'string' ? spots : LAYOUT,
    };
  }
  const patches: SourcePatch[] = [];
  for (const [index, request] of requests.entries()) {
    if (same(request.values, request.before)) continue;
    const spot = spots[index]!;
    if (spot.reason) return { ok: false, reason: spot.reason };
    if (!spot.source) {
      const inserted = insertionPatch(text, spot, request.values);
      if (typeof inserted === 'string') return { ok: false, reason: inserted };
      if (inserted) patches.push(inserted);
      continue;
    }
    const changed = scalarSequencePatches(text, spot.source, request.values);
    if (changed.structuralComment) {
      return { ok: false, reason: CHECK_COMMENTS_REASON };
    }
    patches.push(...(changed.patches ?? []));
  }
  return { ok: true, text: applyPatches(text, patches) };
}
