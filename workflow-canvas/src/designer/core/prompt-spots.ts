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
} from 'yaml';

/**
 * Where the `prompt` of each stage is in a workflow text, as the `yaml` parser
 * reads it. This is the one module of the Designer core that imports a
 * parser, and it only finds ranges: building the new text is left to the
 * writer, which works on the offsets given here.
 */

/** What a stage has for its prompt. */
export type PromptState =
  /** A `prompt` key with text. */
  | 'text'
  /** Neither `prompt` nor `prompt_file`. */
  | 'none'
  /** A `prompt_file` key and no `prompt`. */
  | 'file'
  /** Both keys, which the validator reports. */
  | 'both'
  /** A stage or a value that cannot be told as text, with the `reason`. */
  | 'blocked';

/** The bytes of a `prompt` value. */
export interface ValueSpan {
  start: number;
  /** After the last byte; a block scalar takes its final line break too. */
  end: number;
  /** Whether the value is a block scalar (`|` or `>`). */
  block: boolean;
}

/** The place and state of the prompt of one stage. */
export interface PromptSpot {
  state: PromptState;
  /** The text of `prompt` as YAML reads it, or the empty string. */
  text: string;
  /** The path of `prompt_file`, when the stage has the key. */
  file?: string;
  /** Why the prompt cannot be told, for the `blocked` state. */
  reason?: string;
  /** Whether the stage is a mapping in flow form, as in `{name: a}`. */
  flow: boolean;
  /** The column where the keys of the stage start, counted from 0. */
  column: number;
  /** The start of the `prompt` key. */
  key?: number;
  /** The start of the key after `prompt`, if there is one. */
  next?: number;
  /** The bytes of the `prompt` value, in the `text` and `both` states. */
  value?: ValueSpan;
  /** Why no change of the prompt is written, when the whole file says so. */
  refuse?: string;
  /** The start of the line after the last key of the stage; block form only. */
  insertAt?: number;
}

const NOT_A_MAPPING = 'This stage is not a mapping of keys.';
const NOT_TEXT = 'The prompt of this stage is not text.';
const ALIAS_OR_TAG =
  'The prompt of this stage is an alias, or has an anchor or a tag.';
const TWICE = (key: string) => `This stage has two \`${key}\` keys.`;
const MERGE_KEY = 'This file uses a `<<` merge key.';

const isBreak = (ch: string | undefined) => ch === '\n' || ch === '\r';

function columnOf(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && !isBreak(text[start - 1])) start -= 1;
  return offset - start;
}

// The start of the line after the one that holds the byte before `offset`.
function afterLine(text: string, offset: number): number {
  if (offset > 0 && isBreak(text[offset - 1])) return offset;
  let at = offset;
  while (at < text.length && !isBreak(text[at])) at += 1;
  if (text[at] === '\r' && text[at + 1] === '\n') return at + 2;
  return Math.min(at + 1, text.length);
}

// Where a node ends, or 0 for no node.
function endOf(node: unknown): number {
  return isNode(node) ? (node.range?.[1] ?? 0) : 0;
}

const isKey = (pair: Pair, name: string) =>
  isScalar(pair.key) && pair.key.value === name;

/** The span of the value of the `prompt` pair, or why it is not text. */
function valueOf(
  pair: Pair,
): { text: string; span: ValueSpan } | { reason: string } {
  const { value } = pair;
  if (isAlias(value)) return { reason: ALIAS_OR_TAG };
  if (!isScalar(value) || typeof value.value !== 'string') {
    return { reason: NOT_TEXT };
  }
  if (value.anchor || value.tag || !value.range)
    return { reason: ALIAS_OR_TAG };
  const block = value.type === 'BLOCK_LITERAL' || value.type === 'BLOCK_FOLDED';
  const [start, end] = value.range;
  return { text: value.value, span: { start, end, block } };
}

function spotOf(item: unknown, text: string): PromptSpot {
  const blocked = (reason: string, flow = false): PromptSpot => ({
    state: 'blocked',
    text: '',
    reason,
    flow,
    column: 0,
  });
  if (!isMap(item) || !item.range) return blocked(NOT_A_MAPPING);
  const flow = item.flow === true;
  const first = item.items[0]?.key;
  const column =
    isScalar(first) && first.range ? columnOf(text, first.range[0]) : 0;
  for (const key of ['prompt', 'prompt_file']) {
    if (item.items.filter((p) => isKey(p, key)).length > 1) {
      return blocked(TWICE(key), flow);
    }
  }
  const at = item.items.findIndex((pair) => isKey(pair, 'prompt'));
  const pair = item.items[at];
  const filePair = item.items.find((p) => isKey(p, 'prompt_file'));
  const file =
    filePair &&
    isScalar(filePair.value) &&
    typeof filePair.value.value === 'string'
      ? filePair.value.value
      : undefined;
  const last = item.items.at(-1);
  const lastEnd = Math.max(endOf(last?.key), endOf(last?.value));
  const base = {
    flow,
    column,
    ...(flow ? {} : { insertAt: afterLine(text, lastEnd) }),
  };
  if (filePair && file === undefined) {
    return { ...blocked(NOT_TEXT, flow), ...base };
  }
  if (!pair) {
    return filePair
      ? { state: 'file', text: '', file, ...base }
      : { state: 'none', text: '', ...base };
  }
  const read = valueOf(pair);
  if ('reason' in read) return { ...blocked(read.reason, flow), ...base };
  const nextKey = item.items[at + 1]?.key;
  return {
    state: filePair ? 'both' : 'text',
    text: read.text,
    ...(file === undefined ? {} : { file }),
    ...base,
    key: isScalar(pair.key) ? pair.key.range?.[0] : undefined,
    ...(isScalar(nextKey) && nextKey.range ? { next: nextKey.range[0] } : {}),
    value: read.span,
  };
}

// Whether any mapping of the document has a `<<` key.
function hasMergeKey(doc: Document): boolean {
  let found = false;
  visit(doc, {
    Pair(_, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') {
        found = true;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return found;
}

/**
 * The prompt of each stage of the workflow text, in order, or `undefined`
 * when the text is not one YAML document with a list of stages under one
 * top-level `stages` key. A key that a mapping has twice is not an error here,
 * which lets a stage with two `prompt` keys say so; the check reports it. When
 * the file has a `<<` merge key, every stage carries a reason to refuse a
 * change.
 */
export function promptSpots(text: string): PromptSpot[] | undefined {
  const doc = parseDocument(text, { uniqueKeys: false });
  const root = doc.contents;
  if (doc.errors.length > 0 || !isMap(root)) return undefined;
  if (root.items.filter((pair) => isKey(pair, 'stages')).length !== 1) {
    return undefined;
  }
  const stages = root.get('stages', true);
  if (!isSeq(stages)) return undefined;
  const refuse = hasMergeKey(doc) ? MERGE_KEY : undefined;
  return stages.items.map((item) => ({
    ...spotOf(item, text),
    ...(refuse === undefined ? {} : { refuse }),
  }));
}
