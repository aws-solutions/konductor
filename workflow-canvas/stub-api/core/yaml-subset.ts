// SPDX-License-Identifier: Apache-2.0
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseAllDocuments,
  Scalar,
  type Document,
  type YAMLMap,
} from 'yaml';
import type { Segment, Span } from './diagnostics.ts';

/** A mapping entry whose key is a scalar, with the key as plain text. */
export interface MapEntry {
  keyText: string;
  key: Scalar;
  value: unknown;
}

/** Something the plain YAML subset of the contract does not allow. */
export interface Unsupported {
  path: Segment[];
  span: Span;
  message: string;
}

// YAML 1.2 with the core schema; a repeated key is the check's to report.
const PARSE_OPTIONS = {
  version: '1.2',
  schema: 'core',
  uniqueKeys: false,
  merge: false,
} as const;

/**
 * Parses every document of the text. A lone CR is swapped for LF, which keeps
 * every offset, because only the contract treats it as a line break.
 */
export function parseDocuments(text: string): Document.Parsed[] {
  return Array.from(
    parseAllDocuments(text.replace(/\r(?!\n)/g, '\n'), PARSE_OPTIONS),
  );
}

/** The start and end offsets of a node, or the fallback if it has none. */
export function spanOf(node: unknown, fallback: Span = [0, 0]): Span {
  const range = isNode(node) ? node.range : undefined;
  return range ? [range[0], range[1]] : fallback;
}

/** The span of a document: from its `---` line to the end of its content. */
export function documentSpanOf(doc: Document.Parsed): Span {
  return [doc.range[0], doc.range[1]];
}

/** The span of an entry's value, or of its key when the value has no text. */
export function valueSpanOf(entry: MapEntry): Span {
  const span = spanOf(entry.value);
  return span[1] > span[0] ? span : spanOf(entry.key);
}

/**
 * The text of a key before it is read as a number, boolean or null, so `1`
 * and `'1'` are one key while `1` and `1.0` are two.
 */
export function keyTextOf(key: Scalar): string {
  return typeof key.value === 'string' ? key.value : (key.source ?? '');
}

/** The entries of a mapping that have a scalar key, in text order. */
export function entriesOf(map: YAMLMap): MapEntry[] {
  return map.items.flatMap((pair) =>
    isScalar(pair.key)
      ? [{ keyText: keyTextOf(pair.key), key: pair.key, value: pair.value }]
      : [],
  );
}

/** Finds every anchor, `*` reference, tag, merge key and non-scalar key in a node. */
export function findUnsupported(
  node: unknown,
  path: Segment[] = [],
): Unsupported[] {
  if (isAlias(node))
    return [unsupported(path, node, 'A `*` reference is not allowed.')];
  if (!isNode(node)) return [];
  const found = marksOf(node, path);
  if (isSeq(node)) {
    node.items.forEach((item, index) =>
      found.push(...findUnsupported(item, [...path, index])),
    );
  } else if (isMap(node)) {
    for (const pair of node.items) {
      found.push(...findInPair(pair.key, pair.value, path));
    }
  }
  return found;
}

function findInPair(key: unknown, value: unknown, path: Segment[]) {
  if (!isScalar(key)) {
    return [unsupported(path, key, 'A key must be a plain value.')];
  }
  const keyText = keyTextOf(key);
  const found = marksOf(key, path);
  if (keyText === '<<' && key.type === Scalar.PLAIN) {
    found.push(unsupported(path, key, 'A merge key is not allowed.'));
  }
  return [...found, ...findUnsupported(value, [...path, keyText])];
}

// An anchor or an explicit tag on a node.
function marksOf(node: { anchor?: string; tag?: string }, path: Segment[]) {
  const found: Unsupported[] = [];
  if (node.anchor !== undefined) {
    found.push(unsupported(path, node, 'An anchor is not allowed.'));
  }
  if (node.tag !== undefined) {
    found.push(unsupported(path, node, 'A tag is not allowed.'));
  }
  return found;
}

function unsupported(path: Segment[], node: unknown, message: string) {
  return { path, span: spanOf(node), message };
}
