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
const METADATA_REASON =
  'The outputs of this stage use an anchor, alias or tag, so the editor cannot change them safely. Change them in the YAML tab.';
const DUPLICATE_REASON =
  'The outputs of this stage contain a duplicate key, so the editor cannot change them safely. Change them in the YAML tab.';

interface Patch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function pairNamed(pair: Pair, name: string): boolean {
  return isScalar(pair.key) && pair.key.value === name;
}

function textScalar(node: unknown): node is Scalar<string> {
  return (
    isScalar(node) &&
    typeof node.value === 'string' &&
    node.range !== undefined &&
    node.anchor === undefined &&
    node.tag === undefined
  );
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : text.includes('\r') ? '\r' : '\n';
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
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
    end += 1;
  }
  if (text[end] === '\r' && text[end + 1] === '\n') return end + 2;
  return end < text.length ? end + 1 : end;
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

function mapPairs(map: YAMLMap): readonly Pair[] | string {
  const names = new Set<string>();
  const pairs: Pair[] = [];
  for (const pair of map.items) {
    if (
      isAlias(pair.value) ||
      !textScalar(pair.key) ||
      !textScalar(pair.value)
    ) {
      return METADATA_REASON;
    }
    const name = pair.key.value;
    if (names.has(name)) return DUPLICATE_REASON;
    names.add(name);
    pairs.push(pair);
  }
  return pairs;
}

function replaceMap(
  text: string,
  map: YAMLMap,
  outputs: readonly OutputToWrite[],
): Patch | string {
  if (!map.range) return LAYOUT_REASON;
  const source = text.slice(map.range[0], map.range[1]);
  if (source.includes('#')) return COMMENTS_REASON;
  if (map.flow) {
    return {
      start: map.range[0],
      end: map.range[1],
      text: renderFlow(outputs),
    };
  }
  const first = map.items[0]?.key as Scalar | null | undefined;
  const last = map.items.at(-1);
  const lastKey = last?.key as Scalar | null | undefined;
  const lastValue = last?.value as Scalar | YAMLMap | null | undefined;
  const contentEnd = Math.max(
    lastKey?.range?.[1] ?? 0,
    lastValue?.range?.[1] ?? 0,
  );
  if (!first?.range || contentEnd === 0) return LAYOUT_REASON;
  if (outputs.length === 0) {
    return { start: map.range[0], end: contentEnd, text: '{}' };
  }
  const indent = ' '.repeat(columnOf(text, first.range[0]));
  const eol = eolOf(text);
  return {
    start: map.range[0],
    end: contentEnd,
    text: outputs
      .map(
        ({ name, path }, index) =>
          `${index === 0 ? '' : indent}${name}: ${scalar(path)}`,
      )
      .join(eol),
  };
}

function editMap(
  text: string,
  map: YAMLMap,
  outputs: readonly OutputToWrite[],
): readonly Patch[] | string {
  const parsed = mapPairs(map);
  if (typeof parsed === 'string') return parsed;
  if (parsed.length !== outputs.length) {
    const patch = replaceMap(text, map, outputs);
    return typeof patch === 'string' ? patch : [patch];
  }
  const patches: Patch[] = [];
  for (const [index, output] of outputs.entries()) {
    const pair = parsed[index]!;
    const key = pair.key as Scalar<string>;
    const value = pair.value as Scalar<string>;
    if (key.value !== output.name) {
      patches.push({
        start: key.range![0],
        end: key.range![1],
        text: output.name,
      });
    }
    if (value.value !== output.path) {
      patches.push({
        start: value.range![0],
        end: value.range![1],
        text: scalar(output.path),
      });
    }
  }
  return patches;
}

function insertOutputs(
  text: string,
  stage: YAMLMap,
  outputs: readonly OutputToWrite[],
): Patch | string | undefined {
  if (outputs.length === 0) return undefined;
  if (!stage.range || stage.items.length === 0) return LAYOUT_REASON;
  if (stage.flow) {
    const close = stage.range[1] - 1;
    return {
      start: close,
      end: close,
      text: `${stage.items.length > 0 ? ', ' : ''}outputs: ${renderFlow(outputs)}`,
    };
  }
  const first = stage.items[0]?.key as Scalar | null | undefined;
  const last = stage.items.at(-1);
  const lastKey = last?.key as Scalar | null | undefined;
  const lastValue = last?.value as Scalar | YAMLMap | null | undefined;
  const lastEnd = Math.max(
    lastKey?.range?.[1] ?? 0,
    lastValue?.range?.[1] ?? 0,
  );
  if (!first?.range || lastEnd === 0) return LAYOUT_REASON;
  const eol = eolOf(text);
  const indent = ' '.repeat(columnOf(text, first.range[0]));
  const child = `${indent}  `;
  const at = afterLine(text, lastEnd);
  const prefix =
    at === text.length && !text.endsWith('\n') && !text.endsWith('\r')
      ? eol
      : '';
  return {
    start: at,
    end: at,
    text: `${prefix}${indent}outputs:${eol}${outputs
      .map(({ name, path }) => `${child}${name}: ${scalar(path)}${eol}`)
      .join('')}`,
  };
}

function stageMaps(text: string): readonly YAMLMap[] | string {
  const document = parseDocument(text, { uniqueKeys: false });
  if (document.errors.length > 0 || !isMap(document.contents))
    return LAYOUT_REASON;
  const roots = document.contents.items.filter((pair) =>
    pairNamed(pair, 'stages'),
  );
  if (roots.length !== 1 || !isSeq(roots[0]!.value)) return LAYOUT_REASON;
  const stages: YAMLMap[] = [];
  for (const item of roots[0]!.value.items) {
    if (!isMap(item)) return LAYOUT_REASON;
    stages.push(item);
  }
  return stages;
}

/** The file-wide reason stage outputs cannot be edited in place. */
export function outputsInPlaceBlocker(text: string): string | undefined {
  const stages = stageMaps(text);
  return typeof stages === 'string' ? stages : undefined;
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
  const stages = stageMaps(text);
  if (typeof stages === 'string' || stages.length !== requested.length) {
    return {
      ok: false,
      reason: typeof stages === 'string' ? stages : LAYOUT_REASON,
    };
  }
  const patches: Patch[] = [];
  for (const [index, request] of requested.entries()) {
    if (same(request.outputs, request.before)) continue;
    const stage = stages[index]!;
    const pairs = stage.items.filter((pair) => pairNamed(pair, 'outputs'));
    if (pairs.length > 1) return { ok: false, reason: DUPLICATE_REASON };
    const pair = pairs[0];
    if (!pair) {
      const inserted = insertOutputs(text, stage, request.outputs);
      if (typeof inserted === 'string') return { ok: false, reason: inserted };
      if (inserted) patches.push(inserted);
      continue;
    }
    if (
      isAlias(pair.value) ||
      !isMap(pair.value) ||
      pair.value.anchor ||
      pair.value.tag
    ) {
      return { ok: false, reason: METADATA_REASON };
    }
    const outputsKey = pair.key as Scalar | null | undefined;
    if (
      pair.value.items.length !== request.outputs.length &&
      outputsKey?.range &&
      pair.value.range &&
      text.slice(outputsKey.range[1], pair.value.range[1]).includes('#')
    ) {
      return { ok: false, reason: COMMENTS_REASON };
    }
    const edited = editMap(text, pair.value, request.outputs);
    if (typeof edited === 'string') return { ok: false, reason: edited };
    patches.push(...edited);
  }
  let result = text;
  for (const patch of patches.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, patch.start)}${patch.text}${result.slice(patch.end)}`;
  }
  return { ok: true, text: result };
}
