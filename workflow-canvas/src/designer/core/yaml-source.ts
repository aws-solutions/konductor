// SPDX-License-Identifier: Apache-2.0
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';

export { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit };
export type { Document, Pair, Scalar, YAMLMap, YAMLSeq };

export interface SourcePatch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface TextScalar {
  readonly text: string;
  readonly range: readonly [number, number];
}

const isBreak = (character: string | undefined) =>
  character === '\n' || character === '\r';

export function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
}

export function lineStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && !isBreak(text[start - 1])) start -= 1;
  return start;
}

export function columnOf(text: string, offset: number): number {
  return offset - lineStart(text, offset);
}

export function afterLine(text: string, offset: number): number {
  if (offset > 0 && isBreak(text[offset - 1])) return offset;
  let at = offset;
  while (at < text.length && !isBreak(text[at])) at += 1;
  if (text[at] === '\r' && text[at + 1] === '\n') return at + 2;
  return Math.min(at + 1, text.length);
}

export function nodeEnd(node: unknown): number {
  return isNode(node) ? (node.range?.[1] ?? 0) : 0;
}

export function contentEnd(node: unknown): number {
  if (isMap(node)) {
    return Math.max(
      0,
      ...node.items.flatMap((pair) => [
        contentEnd(pair.key),
        contentEnd(pair.value),
      ]),
    );
  }
  if (isSeq(node)) return Math.max(0, ...node.items.map(contentEnd));
  return nodeEnd(node);
}

export function hasComment(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as { comment?: unknown; commentBefore?: unknown };
  return (
    (typeof node.comment === 'string' && node.comment !== '') ||
    (typeof node.commentBefore === 'string' && node.commentBefore !== '')
  );
}

export const pairNamed = (pair: Pair, name: string) =>
  isScalar(pair.key) && pair.key.value === name;

export function uniquePair(
  map: YAMLMap,
  name: string,
): Pair | 'duplicate' | undefined {
  const pairs = map.items.filter((pair) => pairNamed(pair, name));
  return pairs.length > 1 ? 'duplicate' : pairs[0];
}

export function textScalar(node: unknown): TextScalar | undefined {
  if (
    isAlias(node) ||
    !isScalar(node) ||
    typeof node.value !== 'string' ||
    !node.range ||
    node.anchor ||
    node.tag
  ) {
    return undefined;
  }
  return { text: node.value, range: [node.range[0], node.range[1]] };
}

export function applyPatches(
  text: string,
  patches: readonly SourcePatch[],
): string {
  let next = text;
  for (const patch of [...patches].sort(
    (left, right) => right.start - left.start,
  )) {
    next = `${next.slice(0, patch.start)}${patch.text}${next.slice(patch.end)}`;
  }
  return next;
}

export function insertMapPair(
  text: string,
  map: YAMLMap,
  key: string,
  value: string,
): SourcePatch | undefined {
  if (!map.range || map.items.length === 0) return undefined;
  const last = map.items.at(-1)!;
  if (map.flow) {
    return {
      start: contentEnd(last.value),
      end: contentEnd(last.value),
      text: `, ${key}: ${value}`,
    };
  }
  const first = textScalar(map.items[0]!.key);
  if (!first) return undefined;
  const lastEnd = contentEnd(last);
  const at = afterLine(text, lastEnd);
  const eol = eolOf(text);
  const hadLineBreak = at > lastEnd;
  const prefix = hadLineBreak ? '' : eol;
  const suffix = hadLineBreak ? eol : '';
  const separator = value.startsWith(eol) ? '' : ' ';
  return {
    start: at,
    end: at,
    text: `${prefix}${' '.repeat(columnOf(text, first.range[0]))}${key}:${separator}${value}${suffix}`,
  };
}
