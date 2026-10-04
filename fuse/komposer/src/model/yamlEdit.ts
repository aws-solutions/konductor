// SPDX-License-Identifier: Apache-2.0
// Structured edits to a fuse-flow workflow YAML file that patch the source
// text instead of re-serializing the whole document (decision 13 of
// docs/specs/2026-10-04-komposer-editor-build.md): `yaml`'s Document.toString
// is not byte-identical for these files (folded scalars rewrap), so every
// edit here finds the exact source range of the node or key it changes and
// splices new text into the original string. Everything the edit does not
// touch survives byte for byte, including comments. No React, no DOM, no
// Node APIs: this module runs in the browser as well as in tests.
//
// API:
//
//   export function applyEdit(text: string, edit: Edit): string
//
// `Edit` is a discriminated union on `op`, one member per editable thing in a
// workflow: setWorkflowField, setStepField, setInstruction, setCondition,
// setConsumes, addOutput/removeOutput/setOutput/changeOutputMode,
// addGate/removeGate/setGate, insertStep/deleteStep/moveStep. Step and gate
// indices are positions in the FILE (not the run order the UI may show
// gates in). applyEdit throws a plain Error with a clear message when the
// edit cannot apply (bad index, duplicate id, etc).
//
// Technique: parse with `yaml`'s parseDocument to get a tree of nodes whose
// `.range` is `[start, valueEnd, nodeEnd]` byte offsets into the original
// string. To change a value in place, replace the value node's range with a
// freshly rendered fragment at the same indentation. To add or remove a key,
// splice before/after the right sibling's range, using the enclosing
// mapping's indentation. New fragments are written by hand (not through
// `doc.createNode` + `toString`) so their formatting matches the project's
// conventions exactly: flow lists `[a, b]`, one-key gate mappings, output
// entries as block mappings, folded instructions wrapped at ~100 columns.

import YAML from "yaml";
import { Pair, Scalar, YAMLMap, YAMLSeq } from "yaml";

// ---------------------------------------------------------------------------
// Public types

export type OutputMode = "produces" | "optional_produces" | "updates";
export type GateKind = "owner-action" | "check" | "script" | "agent";

export interface ConditionValue {
  kind: GateKind;
  text: string;
  description?: string;
}

export interface GateFields {
  kind?: GateKind;
  text?: string;
  description?: string | null;
  max_rounds?: number | null;
  guide?: string | null;
  route_back_to?: string[];
}

export interface OutputFields {
  artifact?: string;
  path?: string;
  description?: string | null;
}

export type Edit =
  | { op: "setWorkflowField"; key: "name" | "description"; value: string | null }
  | { op: "setStepField"; step: number; key: "id" | "title" | "phase" | "description"; value: string | null }
  | { op: "setInstruction"; step: number; text: string; style: ">" | "|" }
  | { op: "setCondition"; step: number; condition: ConditionValue | null }
  | { op: "setConsumes"; step: number; ids: string[] }
  | { op: "addOutput"; step: number; mode: OutputMode; artifact: string; path: string; description?: string }
  | { op: "removeOutput"; step: number; mode: OutputMode; index: number }
  | { op: "setOutput"; step: number; mode: OutputMode; index: number; fields: OutputFields }
  | { op: "changeOutputMode"; step: number; mode: OutputMode; index: number; to: OutputMode }
  | { op: "addGate"; step: number; gate: { kind: GateKind; text: string } }
  | { op: "removeGate"; step: number; index: number }
  | { op: "setGate"; step: number; index: number; fields: GateFields }
  | { op: "insertStep"; at: number; step: { id: string; instruction: string } }
  | { op: "deleteStep"; index: number }
  | { op: "moveStep"; from: number; to: number };

// ---------------------------------------------------------------------------
// Shared helpers

const STEP_KEY_ORDER = ["id", "title", "phase", "description", "instruction", "condition", "consumes", "produces", "optional_produces", "updates", "gates"] as const;
const OUTPUT_KEY_ORDER = ["artifact", "path", "description"] as const;

type Range = [number, number, number];

class EditError extends Error {}

function fail(message: string): never {
  throw new EditError(message);
}

function isMap(node: unknown): node is InstanceType<typeof YAMLMap> {
  return node instanceof YAMLMap;
}
function isSeq(node: unknown): node is InstanceType<typeof YAMLSeq> {
  return node instanceof YAMLSeq;
}
function isScalar(node: unknown): node is InstanceType<typeof Scalar> {
  return node instanceof Scalar;
}

function parseDoc(text: string): YAML.Document.Parsed {
  const doc = YAML.parseDocument(text, { keepSourceTokens: true });
  if (doc.errors.length) fail(`not valid YAML: ${doc.errors[0].message}`);
  return doc;
}

function rootMap(doc: YAML.Document.Parsed): InstanceType<typeof YAMLMap> {
  const contents = doc.contents;
  if (!isMap(contents)) fail("workflow file does not have a top-level mapping");
  return contents;
}

function findPair(map: InstanceType<typeof YAMLMap>, key: string): InstanceType<typeof Pair> | undefined {
  return map.items.find((p) => isScalar(p.key) && p.key.value === key);
}

function stepsSeq(doc: YAML.Document.Parsed): InstanceType<typeof YAMLSeq> {
  const steps = findPair(rootMap(doc), "steps")?.value;
  if (!isSeq(steps)) fail("workflow has no steps list");
  return steps;
}

function stepMap(doc: YAML.Document.Parsed, index: number): InstanceType<typeof YAMLMap> {
  const steps = stepsSeq(doc);
  const item = steps.items[index];
  if (!item) fail(`step index ${index} is out of range (workflow has ${steps.items.length} steps)`);
  if (!isMap(item)) fail(`step ${index} is not a mapping`);
  return item;
}

function stepIdOf(step: InstanceType<typeof YAMLMap>): string {
  const idPair = findPair(step, "id");
  const v = idPair?.value;
  return isScalar(v) ? String(v.value) : "";
}

// The number of columns from the start of `offset`'s line to `offset`
// itself, as a string of spaces. Unlike `indentAt`, this does not stop at
// the first non-space character, so it correctly measures the column of a
// key in `  - id: x` (4) rather than the leading-space run before the `-`
// (2).
function columnIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return " ".repeat(offset - lineStart);
}

// The indentation of a mapping's own keys (the column its first key starts
// at), whether or not the mapping is itself a sequence item.
function fieldIndent(text: string, map: InstanceType<typeof YAMLMap>): string {
  const first = map.items[0];
  const offset = first && isScalar(first.key) ? (first.key.range as Range)[0] : (map.range as Range)[0];
  return columnIndent(text, offset);
}

// The indentation of the `- ` marker that introduces a sequence item whose
// node starts at `offset` (which points at the item's own content, e.g. a
// mapping's first key, two columns after the dash).
function dashIndent(text: string, offset: number): string {
  const col = columnIndent(text, offset);
  return col.slice(0, Math.max(0, col.length - 2));
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

// The end of the line (including its newline) containing `offset`, i.e. the
// start of the next line, or text.length if there is none.
function lineEndOf(text: string, offset: number): number {
  const nl = text.indexOf("\n", offset);
  return nl === -1 ? text.length : nl + 1;
}

// A splice edit: replace text[start:end) with `insert`.
interface Splice {
  start: number;
  end: number;
  insert: string;
}

function applySplices(text: string, splices: Splice[]): string {
  const sorted = [...splices].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) fail("internal error: overlapping edits");
  }
  let out = "";
  let pos = 0;
  for (const s of sorted) {
    out += text.slice(pos, s.start) + s.insert;
    pos = s.end;
  }
  out += text.slice(pos);
  return out;
}

// Collection node ranges include their terminating newline. Preserve it when
// replacing a whole mapping/list node so the following key or sequence item
// cannot be joined onto the replacement's last line.
function replacementSplice(text: string, start: number, end: number, insert: string): Splice {
  const keepsNewline = text.slice(start, end).endsWith("\n") && !insert.endsWith("\n");
  return { start, end, insert: keepsNewline ? insert + "\n" : insert };
}

// YAML plain-scalar safety: quote a string value if it is not safe to write
// unquoted (empty, looks like another type, has special leading/trailing
// chars, or contains a colon-space / comment-start sequence).
function plainScalar(value: string): string {
  const needsQuote =
    value === "" ||
    /^[\s]/.test(value) ||
    /[\s]$/.test(value) ||
    /^[-?:,\[\]{}#&*!|>'"%@`]/.test(value) ||
    /: |:$/.test(value) ||
    / #/.test(value) ||
    /^(true|false|null|~|yes|no)$/i.test(value) ||
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value) ||
    value.includes("\n") ||
    value.includes('"') === false && value.includes("'") && false; // placeholder, no-op
  if (!needsQuote) return value;
  // Prefer single quotes, doubling embedded single quotes, unless the value
  // contains characters that need double-quote escaping (none of our values
  // do in practice, but fall back safely).
  return `'${value.replace(/'/g, "''")}'`;
}

function scalarLine(key: string, value: string): string {
  return `${key}: ${plainScalar(value)}`;
}

// Render a flow list, e.g. "[a, b]".
function flowList(values: string[]): string {
  return `[${values.map(plainScalar).join(", ")}]`;
}

// Fold `text` at the given indentation, wrapped at ~100 columns, YAML `>`
// style: each physical line becomes one wrapped paragraph; blank lines
// (paragraph breaks) are preserved as truly blank lines, which the folded
// style turns back into a single newline when parsed.
function foldText(text: string, indent: string, width = 100): string {
  // In a folded scalar a single line break reads as a space, and each empty
  // line reads as one newline. So a run of k newlines in the text is written
  // as k empty lines, and each paragraph between them is wrapped.
  const avail = Math.max(20, width - indent.length);
  const wrap = (para: string) => {
    const words = para.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      if (cur && cur.length + 1 + word.length > avail) {
        lines.push(cur);
        cur = word;
      } else {
        cur = cur ? `${cur} ${word}` : word;
      }
    }
    if (cur) lines.push(cur);
    return lines.map((l) => indent + l);
  };
  const out: string[] = [];
  for (const part of text.split(/(\n+)/)) {
    if (part.startsWith("\n")) out.push(...Array<string>(part.length).fill(""));
    else if (part) out.push(...wrap(part));
  }
  return out.join("\n");
}

function blockScalarLines(key: string, indent: string, text: string, style: ">" | "|"): string {
  const body = text.replace(/\n+$/, "");
  const bodyIndent = indent + "  ";
  if (style === "|") {
    const lines = body.split("\n").map((l) => (l ? bodyIndent + l : ""));
    return `${indent}${key}: |\n${lines.join("\n")}\n`;
  }
  const folded = foldText(body, bodyIndent);
  return `${indent}${key}: >\n${folded}\n`;
}

// Does `text` fit comfortably as a plain scalar on one line (no block style
// needed)? Used to decide whether setInstruction with style '>' still
// produces a block or can stay a short plain scalar when parsed back and
// re-edited. Per the brief, setInstruction always honors the chosen style
// when the text is written as a block; but a very short instruction reads
// fine as a plain scalar too. We only use a plain scalar when the text has
// no newlines and is short enough that a reader would normally not use a
// block style, mirroring how real workflow files are written (short
// instructions, like "Polish it.", are plain scalars).
function shouldUsePlainScalar(text: string): boolean {
  return !text.includes("\n") && text.length <= 80;
}

// ---------------------------------------------------------------------------
// Find where in a mapping a new key belongs, given a fixed key order, and
// build the splice that inserts it. `rendered` must already be fully
// indented (including its first line) and must NOT end with a newline.
function insertKeySplice(text: string, map: InstanceType<typeof YAMLMap>, keyOrder: readonly string[], key: string, rendered: string): Splice {
  const myRank = keyOrder.indexOf(key);
  if (myRank === -1) fail(`internal error: unknown key "${key}"`);
  // Find the first existing key whose rank is greater than ours; insert
  // before it. If none, append after the last existing key (or as the first
  // key in an empty mapping, which should not happen for steps/workflow).
  let insertBeforeOffset: number | undefined;
  let lastEnd: number | undefined;
  for (const pair of map.items) {
    if (!isScalar(pair.key)) continue;
    const k = String(pair.key.value);
    const rank = keyOrder.indexOf(k);
    const pairRange = pairRangeOf(pair);
    if (rank === -1) continue;
    if (rank > myRank && insertBeforeOffset === undefined) insertBeforeOffset = pairRange[0];
    lastEnd = pairRange[2];
  }
  if (insertBeforeOffset !== undefined) {
    const at = lineStartOf(text, insertBeforeOffset);
    return { start: at, end: at, insert: rendered + "\n" };
  }
  if (lastEnd !== undefined) {
    const at = lineEndOf(text, lastEnd - 1);
    return { start: at, end: at, insert: rendered + "\n" };
  }
  fail("internal error: empty mapping has no key to anchor insertion");
}

// The full source range of a Pair (key start through value end, including
// any trailing same-line comment but not the newline).
function pairRangeOf(pair: InstanceType<typeof Pair>): Range {
  const key = pair.key;
  const value = pair.value;
  const start = isScalar(key) || isMap(key) || isSeq(key) ? (key.range as Range)[0] : 0;
  let end: number;
  if (value && (isScalar(value) || isMap(value) || isSeq(value))) {
    end = (value.range as Range)[2];
  } else if (isScalar(key)) {
    end = (key.range as Range)[2];
  } else {
    end = start;
  }
  return [start, end, end];
}

// Remove an entire key: value line(s), including its leading comment lines
// that are directly attached (commentBefore) and the line's own trailing
// newline. If this is the only remaining key the mapping is left empty;
// callers that need to drop the key entirely when it becomes empty do that
// separately (removeMappingKey below).
function removeKeySplice(text: string, map: InstanceType<typeof YAMLMap>, key: string): Splice {
  const pair = findPair(map, key);
  if (!pair) fail(`internal error: key "${key}" not found`);
  const range = pairRangeOf(pair);
  const start = lineStartOf(text, range[0]);
  const end = lineEndOf(text, range[1] - 1 >= range[0] ? range[1] - 1 : range[0]);
  return { start, end, insert: "" };
}

// ---------------------------------------------------------------------------
// setWorkflowField / setStepField (scalar string|null fields)

function applySetWorkflowField(text: string, edit: { key: "name" | "description"; value: string | null }): string {
  const doc = parseDoc(text);
  const map = rootMap(doc);
  return applyScalarField(text, map, STEP_KEY_ORDER.length ? (["version", "name", "description", "steps"] as const) : [], edit.key, edit.value, { required: edit.key === "name" });
}

function applyScalarField(
  text: string,
  map: InstanceType<typeof YAMLMap>,
  keyOrder: readonly string[],
  key: string,
  value: string | null,
  opts: { required: boolean },
): string {
  const pair = findPair(map, key);
  const current = pair && isScalar(pair.value) ? String(pair.value.value) : undefined;
  if (value === null) {
    if (opts.required) fail(`${key} is required and cannot be cleared`);
    if (pair === undefined) return text; // no-op
    return applySplices(text, [removeKeySplice(text, map, key)]);
  }
  if (current === value) return text; // no-op
  if (pair) {
    const valueNode = pair.value;
    if (!isScalar(valueNode)) fail(`internal error: ${key} is not a scalar`);
    const range = valueNode.range as Range;
    return applySplices(text, [{ start: range[0], end: range[1], insert: plainScalar(value) }]);
  }
  const indent = fieldIndent(text, map);
  const splice = insertKeySplice(text, map, keyOrder, key, `${indent}${scalarLine(key, value)}`);
  return applySplices(text, [splice]);
}

function applySetStepField(text: string, edit: { step: number; key: "id" | "title" | "phase" | "description"; value: string | null }): string {
  const doc = parseDoc(text);
  const step = stepMap(doc, edit.step);
  if (edit.key === "id") return applyRenameId(text, doc, edit.step, edit.value);
  return applyScalarField(text, step, STEP_KEY_ORDER, edit.key, edit.value, { required: false });
}

function applyRenameId(text: string, doc: YAML.Document.Parsed, stepIndex: number, value: string | null): string {
  if (value === null) fail("id is required and cannot be cleared");
  const step = stepMap(doc, stepIndex);
  const oldId = stepIdOf(step);
  if (oldId === value) return text; // no-op

  const steps = stepsSeq(doc);
  for (const other of steps.items) {
    if (isMap(other) && other !== step && stepIdOf(other) === value) fail(`step id "${value}" is already used by another step`);
  }

  const splices: Splice[] = [];
  const idPair = findPair(step, "id");
  if (!idPair || !isScalar(idPair.value)) fail("internal error: step has no id scalar");
  const idRange = idPair.value.range as Range;
  splices.push({ start: idRange[0], end: idRange[1], insert: plainScalar(value) });

  // Rewrite every route_back_to, in any step, that named the old id.
  for (const other of steps.items) {
    if (!isMap(other)) continue;
    const gatesPair = findPair(other, "gates");
    const gatesValue = gatesPair?.value;
    const gateMaps: InstanceType<typeof YAMLMap>[] = [];
    if (isSeq(gatesValue)) gateMaps.push(...gatesValue.items.filter(isMap));
    else if (isMap(gatesValue)) gateMaps.push(gatesValue);
    for (const gateMap of gateMaps) {
      const rbtPair = findPair(gateMap, "route_back_to");
      if (!rbtPair) continue;
      const rbtValue = rbtPair.value;
      if (isScalar(rbtValue) && String(rbtValue.value) === oldId) {
        const r = rbtValue.range as Range;
        splices.push({ start: r[0], end: r[1], insert: plainScalar(value) });
      } else if (isSeq(rbtValue)) {
        for (const item of rbtValue.items) {
          if (isScalar(item) && String(item.value) === oldId) {
            const r = item.range as Range;
            splices.push({ start: r[0], end: r[1], insert: plainScalar(value) });
          }
        }
      }
    }
  }
  return applySplices(text, splices);
}

// ---------------------------------------------------------------------------
// setInstruction

function applySetInstruction(text: string, edit: { step: number; text: string; style: ">" | "|" }): string {
  const doc = parseDoc(text);
  const step = stepMap(doc, edit.step);
  const pair = findPair(step, "instruction");
  if (!pair || !pair.value) fail("step has no instruction to edit");
  const valueNode = pair.value;
  if (!isScalar(valueNode)) fail("internal error: instruction is not a scalar");

  // Determine the full range to replace: for a block scalar this is the key
  // line through the end of the block body; for a plain/quoted scalar it is
  // just the value.
  const keyNode = pair.key;
  if (!isScalar(keyNode)) fail("internal error: instruction key is not a scalar");
  const keyRange = keyNode.range as Range;
  const indent = columnIndent(text, keyRange[0]);
  const valueRange = valueNode.range as Range;
  const fullStart = keyRange[0];
  const fullEnd = valueRange[1];
  const requestedType = edit.style === ">" ? Scalar.BLOCK_FOLDED : Scalar.BLOCK_LITERAL;
  if (valueNode.type === requestedType && String(valueNode.value).trim() === edit.text.trim()) return text;

  // setInstruction always honors the selected block style, even for short
  // text; the style is explicit editor state, not a formatting hint.
  const rendered = blockScalarLines("instruction", indent, edit.text, edit.style)
    .slice(indent.length)
    .replace(/\n$/, "");

  // Replace from the start of the key line to the end of the value
  // (including, for block scalars, all its body lines) but not the trailing
  // newline, so the splice is line-content-only and existing line endings
  // stay intact.
  return applySplices(text, [replacementSplice(text, fullStart, fullEnd, rendered)]);
}

// ---------------------------------------------------------------------------
// setCondition

function conditionLines(kind: GateKind, text: string, description: string | undefined, indent: string): string {
  let out = `${indent}condition:\n${indent}  ${kind}: ${plainScalar(text)}`;
  if (description !== undefined) out += `\n${indent}  description: ${plainScalar(description)}`;
  return out;
}

function readCondition(node: unknown): ConditionValue {
  if (isMap(node)) {
    const kindPair = node.items.find((p) => isScalar(p.key) && (["owner-action", "check", "script", "agent"] as const).includes(String(p.key.value) as GateKind));
    if (!kindPair || !isScalar(kindPair.key) || !isScalar(kindPair.value)) fail("condition mapping has no kind key");
    const description = scalarOf(node, "description");
    return { kind: String(kindPair.key.value) as GateKind, text: String(kindPair.value.value), ...(description === undefined ? {} : { description }) };
  }
  if (isScalar(node)) {
    const raw = String(node.value).trim();
    const match = /^([a-z-]+)\s*(?:\(\s*"?(.*?)"?\s*\)|:(.*))$/s.exec(raw);
    if (!match) fail(`cannot read condition string "${raw}"`);
    return { kind: match[1] as GateKind, text: (match[2] ?? match[3] ?? "").trim() };
  }
  fail("condition must be a mapping or string");
}

function sameCondition(a: ConditionValue, b: ConditionValue): boolean {
  return a.kind === b.kind && a.text === b.text && a.description === b.description;
}

function applySetCondition(text: string, edit: { step: number; condition: ConditionValue | null }): string {
  const doc = parseDoc(text);
  const step = stepMap(doc, edit.step);
  const pair = findPair(step, "condition");
  const indent = fieldIndent(text, step);

  if (edit.condition === null) {
    if (!pair) return text; // no-op
    return applySplices(text, [removeKeySplice(text, step, "condition")]);
  }
  if (pair?.value && sameCondition(readCondition(pair.value), edit.condition)) return text;

  // A condition mapping: change only the kind and text and the description,
  // so the other lines and their comments stay as written.
  if (pair && isMap(pair.value)) {
    const current = readCondition(pair.value);
    {
      let out = text;
      if (current.kind !== edit.condition.kind || current.text !== edit.condition.text) {
        const kindPair = findPair(pair.value, current.kind)!;
        const k = (kindPair.key as InstanceType<typeof Scalar>).range as Range;
        const r = (kindPair.value as InstanceType<typeof Scalar>).range as Range;
        out = applySplices(out, [{ start: k[0], end: r[1], insert: `${edit.condition.kind}: ${plainScalar(edit.condition.text)}` }]);
      }
      if (current.description !== edit.condition.description) {
        const condition = findPair(stepMap(parseDoc(out), edit.step), "condition")!.value as InstanceType<typeof YAMLMap>;
        out = applyScalarField(out, condition, ["owner-action", "check", "script", "agent", "description"], "description", edit.condition.description ?? null, {
          required: false,
        });
      }
      return out;
    }
  }

  const rendered = conditionLines(edit.condition.kind, edit.condition.text, edit.condition.description, indent);

  if (pair) {
    const range = pairRangeOf(pair);
    return applySplices(text, [replacementSplice(text, range[0], range[1], rendered.slice(indent.length))]);
  }
  const splice = insertKeySplice(text, step, STEP_KEY_ORDER, "condition", rendered);
  return applySplices(text, [splice]);
}

// ---------------------------------------------------------------------------
// setConsumes

function applySetConsumes(text: string, edit: { step: number; ids: string[] }): string {
  const doc = parseDoc(text);
  const step = stepMap(doc, edit.step);
  const pair = findPair(step, "consumes");

  if (edit.ids.length === 0) {
    if (!pair) return text;
    return applySplices(text, [removeKeySplice(text, step, "consumes")]);
  }
  if (pair?.value && isSeq(pair.value)) {
    const current = pair.value.items.filter(isScalar).map((item) => String(item.value));
    if (current.length === edit.ids.length && current.every((id, index) => id === edit.ids[index])) return text;
  }

  // A block list: remove and append items one by one, so the items that stay
  // keep their lines and comments. Only a reorder rewrites the list.
  if (pair?.value && isSeq(pair.value) && !pair.value.flow && pair.value.items.length > 0) {
    const items = pair.value.items.filter(isScalar);
    const current = items.map((item) => String(item.value));
    const kept = current.filter((id) => edit.ids.includes(id));
    const added = edit.ids.filter((id) => !current.includes(id));
    if ([...kept, ...added].join("\n") === edit.ids.join("\n") && kept.length > 0) {
      const dash = dashIndent(text, (items[0].range as Range)[0]);
      const splices: Splice[] = items
        .filter((item) => !edit.ids.includes(String(item.value)))
        .map((item) => ({ ...itemFullRange(text, item as { range?: Range }), insert: "" }));
      if (added.length) {
        const last = items[items.length - 1].range as Range;
        const at = lineEndOf(text, Math.max(last[0], last[2] - 1));
        splices.push({ start: at, end: at, insert: added.map((id) => `${dash}- ${plainScalar(id)}\n`).join("") });
      }
      return applySplices(text, splices);
    }
  }

  const indent = fieldIndent(text, step);
  const rendered = `${indent}consumes: ${flowList(edit.ids)}`;

  if (pair) {
    const range = pairRangeOf(pair);
    return applySplices(text, [replacementSplice(text, range[0], range[1], rendered.slice(indent.length))]);
  }
  const splice = insertKeySplice(text, step, STEP_KEY_ORDER, "consumes", rendered);
  return applySplices(text, [splice]);
}

// ---------------------------------------------------------------------------
// Outputs: addOutput, removeOutput, setOutput, changeOutputMode

function outputEntryLines(indent: string, fields: { artifact: string; path: string; description?: string }): string {
  const lines = [`${indent}- artifact: ${plainScalar(fields.artifact)}`, `${indent}  path: ${plainScalar(fields.path)}`];
  if (fields.description !== undefined) lines.push(`${indent}  description: ${plainScalar(fields.description)}`);
  return lines.join("\n");
}

// Normalize a mode's value to a list of its item maps, converting a single
// (non-list) mapping to a one-item list in the source when needed. Returns
// the (possibly rewritten) text plus a fresh doc/pair/items for continued
// editing, since a conversion changes offsets.
// Rewrite a step key whose value is a single entry (`produces:` with one
// artifact mapping, `gates:` with one gate) as a one-item list, keeping every
// byte of the entry: a block mapping's lines, comments included, move from the
// mapping's column to the list item's, and its first key line gets the "- ".
// A flow mapping or a string entry moves onto its own "- " line unchanged.
function singletonAsList(text: string, stepIndex: number, key: string): string {
  const step = stepMap(parseDoc(text), stepIndex);
  const pair = findPair(step, key);
  if (!pair || !isScalar(pair.key)) fail(`internal error: step has no ${key}`);
  const value = pair.value;
  const dash = fieldIndent(text, step) + "  ";
  if (isMap(value) && !value.flow && value.items.length > 0 && isScalar(value.items[0].key)) {
    const firstKey = (value.items[0].key.range as Range)[0];
    const base = columnIndent(text, firstKey).length;
    const range = value.range as Range;
    const start = lineEndOf(text, (pair.key.range as Range)[0]);
    const end = lineEndOf(text, Math.max(range[0], range[2] - 1));
    const firstLine = text.slice(start, firstKey).split("\n").length - 1;
    const lines = text
      .slice(start, end)
      .split("\n")
      .map((line, i) => {
        if (line.trim() === "") return line;
        const lead = line.length - line.trimStart().length;
        const body = line.trimStart();
        if (i === firstLine) return `${dash}- ${body}`;
        return `${" ".repeat(dash.length + 2 + Math.max(0, lead - base))}${body}`;
      });
    return applySplices(text, [{ start, end, insert: lines.join("\n") }]);
  }
  if (!isMap(value) && !isScalar(value)) fail(`${key} must be a mapping, string, or list`);
  const range = value.range as Range;
  const source = text.slice(range[0], range[1]);
  const keyEnd = (pair.key.range as Range)[1];
  return applySplices(text, [{ start: keyEnd, end: range[1], insert: `:\n${dash}- ${source}` }]);
}

// Rewrite a step key whose value is a non-empty flow list (`[a, b]`,
// `[{ artifact: x, path: y }]`) as a block list, one "- " line per item, each
// item's source kept as written. Edits that add, remove or move one item work
// on block lists only.
function flowListAsBlock(text: string, stepIndex: number, key: string): string {
  const step = stepMap(parseDoc(text), stepIndex);
  return flowSeqAsBlock(text, step, key, fieldIndent(text, step) + "  ");
}

// The same for any mapping's key, with the list items' "- " at `dash`.
function flowSeqAsBlock(text: string, map: InstanceType<typeof YAMLMap>, key: string, dash: string): string {
  const pair = findPair(map, key);
  if (!pair || !isScalar(pair.key) || !isSeq(pair.value) || !pair.value.flow || pair.value.items.length === 0) return text;
  const items = pair.value.items.map((item) => {
    const r = (item as { range: Range }).range;
    return `${dash}- ${text.slice(r[0], r[1])}`;
  });
  const keyEnd = (pair.key.range as Range)[1];
  const end = (pair.value.range as Range)[1];
  return applySplices(text, [{ start: keyEnd, end, insert: `:\n${items.join("\n")}` }]);
}

// Steps written as a flow list become a block list before a step is
// inserted, deleted or moved, each step as written.
function blockSteps(text: string): string {
  return flowSeqAsBlock(text, rootMap(parseDoc(text)), "steps", "  ");
}

// Replace an empty flow list (`key: []`) with a block list holding `entry`
// (fully indented lines, no trailing newline).
function fillEmptyList(text: string, map: InstanceType<typeof YAMLMap>, key: string, entry: string): string {
  const pair = findPair(map, key);
  if (!pair || !isScalar(pair.key) || !isSeq(pair.value)) fail(`internal error: ${key} is not a list`);
  const keyEnd = (pair.key.range as Range)[1];
  const end = (pair.value.range as Range)[1];
  return applySplices(text, [{ start: keyEnd, end, insert: `:\n${entry}` }]);
}

function ensureOutputList(text: string, stepIndex: number, mode: OutputMode): { text: string; doc: YAML.Document.Parsed; step: InstanceType<typeof YAMLMap> } {
  const doc = parseDoc(text);
  const step = stepMap(doc, stepIndex);
  const pair = findPair(step, mode);
  if (!pair || !pair.value) return { text, doc, step };
  if (isSeq(pair.value)) {
    if (!pair.value.flow || pair.value.items.length === 0) return { text, doc, step };
    const newText = flowListAsBlock(text, stepIndex, mode);
    const newDoc = parseDoc(newText);
    return { text: newText, doc: newDoc, step: stepMap(newDoc, stepIndex) };
  }
  if (isMap(pair.value)) {
    const newText = singletonAsList(text, stepIndex, mode);
    const newDoc = parseDoc(newText);
    return { text: newText, doc: newDoc, step: stepMap(newDoc, stepIndex) };
  }
  fail(`internal error: ${mode} is neither a mapping nor a list`);
}

function scalarOf(map: InstanceType<typeof YAMLMap>, key: string): string | undefined {
  const pair = findPair(map, key);
  return pair && isScalar(pair.value) ? String(pair.value.value) : undefined;
}

function applyAddOutput(text: string, edit: { step: number; mode: OutputMode; artifact: string; path: string; description?: string }): string {
  const normalized = ensureOutputList(text, edit.step, edit.mode);
  const { doc, step } = normalized;
  text = normalized.text;
  const pair = findPair(step, edit.mode);
  const fieldLevelIndent = fieldIndent(text, step);
  const seqForIndent = pair && pair.value && isSeq(pair.value) ? pair.value : undefined;
  const itemIndent = seqForIndent && seqForIndent.items.length > 0 ? dashIndent(text, (seqForIndent.items[0] as { range?: Range }).range![0]) : fieldLevelIndent + "  ";
  const entry = outputEntryLines(itemIndent, { artifact: edit.artifact, path: edit.path, description: edit.description });

  if (!pair || !pair.value) {
    const rendered = `${fieldLevelIndent}${edit.mode}:\n${entry}`;
    const splice = insertKeySplice(text, step, STEP_KEY_ORDER, edit.mode, rendered);
    return applySplices(text, [splice]);
  }
  const seq = pair.value;
  if (!isSeq(seq)) fail(`internal error: ${edit.mode} is not a list after normalization`);
  if (seq.items.length === 0) return fillEmptyList(text, step, edit.mode, entry);
  const lastItem = seq.items[seq.items.length - 1];
  const lastRange = (lastItem as { range?: Range }).range as Range;
  const insertAt = lineEndOf(text, lastRange[1] - 1 >= lastRange[0] ? lastRange[1] - 1 : lastRange[0]);
  return applySplices(text, [{ start: insertAt, end: insertAt, insert: entry + "\n" }]);
  void doc;
}

function outputList(step: InstanceType<typeof YAMLMap>, mode: OutputMode): InstanceType<typeof YAMLSeq> | undefined {
  const pair = findPair(step, mode);
  if (!pair || !pair.value) return undefined;
  if (isSeq(pair.value)) return pair.value;
  return undefined;
}

function applyRemoveOutput(text: string, edit: { step: number; mode: OutputMode; index: number }): string {
  const normalized = ensureOutputList(text, edit.step, edit.mode);
  text = normalized.text;
  const { step } = normalized;
  const seq = outputList(step, edit.mode);
  if (!seq) fail(`step has no ${edit.mode} list`);
  const item = seq.items[edit.index];
  if (!item) fail(`${edit.mode} index ${edit.index} is out of range`);

  if (seq.items.length === 1) {
    return applySplices(text, [removeKeySplice(text, step, edit.mode)]);
  }
  const { start, end } = itemFullRange(text, item as { range?: Range });
  return applySplices(text, [{ start, end, insert: "" }]);
}

function outputItemAt(step: InstanceType<typeof YAMLMap>, mode: OutputMode, index: number): InstanceType<typeof YAMLMap> | undefined {
  const value = findPair(step, mode)?.value;
  if (isMap(value)) return index === 0 ? value : undefined;
  if (isSeq(value)) {
    const item = value.items[index];
    return isMap(item) ? item : undefined;
  }
  return undefined;
}

function outputFieldsDiffer(entry: InstanceType<typeof YAMLMap>, fields: OutputFields): boolean {
  if (fields.artifact !== undefined && scalarOf(entry, "artifact") !== fields.artifact) return true;
  if (fields.path !== undefined && scalarOf(entry, "path") !== fields.path) return true;
  if ("description" in fields) {
    const requested = fields.description === null ? undefined : fields.description;
    if (scalarOf(entry, "description") !== requested) return true;
  }
  return false;
}

function applySetOutput(text: string, edit: { step: number; mode: OutputMode; index: number; fields: OutputFields }): string {
  const originalStep = stepMap(parseDoc(text), edit.step);
  const originalEntry = outputItemAt(originalStep, edit.mode, edit.index);
  if (!originalEntry) fail(`${edit.mode} index ${edit.index} is out of range`);
  if (!outputFieldsDiffer(originalEntry, edit.fields)) return text;

  // Only a single mapping needs to become a list first; an entry already in a
  // list, block or flow, is patched where it is.
  const current = findPair(originalStep, edit.mode)?.value;
  const normalized = isSeq(current) ? { text, step: originalStep } : ensureOutputList(text, edit.step, edit.mode);
  text = normalized.text;
  const { step } = normalized;
  const seq = outputList(step, edit.mode);
  if (!seq) fail(`step has no ${edit.mode} list`);
  const entryMap = seq.items[edit.index];
  if (!entryMap || !isMap(entryMap)) fail(`${edit.mode} index ${edit.index} is out of range`);

  // A flow entry (`{ artifact: x, path: y }`) that gains or loses a key is
  // written again on its one line; a flow mapping holds no comments.
  const addsOrRemoves = OUTPUT_KEY_ORDER.some(
    (key) => key in edit.fields && (edit.fields[key] === null || edit.fields[key] === undefined) !== !findPair(entryMap, key),
  );
  if (entryMap.flow && addsOrRemoves) {
    const merged = { artifact: scalarOf(entryMap, "artifact"), path: scalarOf(entryMap, "path"), description: scalarOf(entryMap, "description") };
    for (const key of OUTPUT_KEY_ORDER) if (key in edit.fields) merged[key] = edit.fields[key] ?? undefined;
    const body = OUTPUT_KEY_ORDER.filter((key) => merged[key] !== undefined).map((key) => `${key}: ${plainScalar(merged[key]!)}`);
    const r = entryMap.range as Range;
    return applySplices(text, [{ start: r[0], end: r[1], insert: `{ ${body.join(", ")} }` }]);
  }

  const splices: Splice[] = [];
  for (const key of OUTPUT_KEY_ORDER) {
    if (!(key in edit.fields)) continue;
    const value = edit.fields[key];
    const pair = findPair(entryMap, key);
    if (value === null || value === undefined) {
      if (key === "description" && pair) splices.push(removeKeySplice(text, entryMap, key));
      continue;
    }
    if (pair && isScalar(pair.value)) {
      const r = pair.value.range as Range;
      splices.push({ start: r[0], end: r[1], insert: plainScalar(value) });
    } else if (!pair) {
      const indent = fieldIndent(text, entryMap);
      splices.push(insertKeySplice(text, entryMap, OUTPUT_KEY_ORDER, key, `${indent}${key}: ${plainScalar(value)}`));
    }
  }
  if (splices.length === 0) return text;
  return applySplices(text, splices);
}

function applyChangeOutputMode(text: string, edit: { step: number; mode: OutputMode; index: number; to: OutputMode }): string {
  if (edit.mode === edit.to) return text;
  const normalized = ensureOutputList(text, edit.step, edit.mode);
  text = normalized.text;
  const { step } = normalized;
  const seq = outputList(step, edit.mode);
  if (!seq) fail(`step has no ${edit.mode} list`);
  const entry = seq.items[edit.index];
  if (!entry || !isMap(entry)) fail(`${edit.mode} index ${edit.index} is out of range`);

  // The entry's own lines, with the comment lines it owns (itemFullRange).
  // They move to the other list as written.
  const range = entry.range as Range;
  const { start } = itemFullRange(text, entry as { range?: Range });
  const end = lineEndOf(text, Math.max(range[0], range[2] - 1));
  const dashColumn = dashIndent(text, range[0]).length;
  const block = text.slice(start, end);
  const removed =
    seq.items.length === 1
      ? applySplices(text, [removeKeySplice(text, step, edit.mode)])
      : applySplices(text, [{ start, end, insert: "" }]);

  const targetStep = stepMap(parseDoc(removed), edit.step);
  const target = findPair(targetStep, edit.to);
  const fieldLevel = fieldIndent(removed, targetStep);
  const reindent = (dash: string) =>
    block
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => (line.trim() === "" ? line : dash + line.slice(dashColumn)))
      .join("\n");
  if (!target || !target.value) {
    const rendered = `${fieldLevel}${edit.to}:\n${reindent(fieldLevel + "  ")}`;
    return applySplices(removed, [insertKeySplice(removed, targetStep, STEP_KEY_ORDER, edit.to, rendered)]);
  }
  const list = ensureOutputList(removed, edit.step, edit.to);
  const listSeq = outputList(list.step, edit.to);
  if (!listSeq) fail(`internal error: ${edit.to} is not a list after normalization`);
  if (listSeq.items.length === 0) return fillEmptyList(list.text, list.step, edit.to, reindent(fieldLevel + "  "));
  const rangeOf = (node: unknown) => (node as { range: Range }).range;
  const last = rangeOf(listSeq.items[listSeq.items.length - 1]);
  const at = lineEndOf(list.text, Math.max(last[0], last[2] - 1));
  const dash = dashIndent(list.text, rangeOf(listSeq.items[0])[0]);
  return applySplices(list.text, [{ start: at, end: at, insert: `${reindent(dash)}\n` }]);
}

// ---------------------------------------------------------------------------
// Gates

function gateLines(indent: string, kind: GateKind, text: string, fields: { description?: string; route_back_to?: string[]; max_rounds?: number; guide?: string }): string {
  // Key order: the kind, then description, guide, max_rounds, route_back_to
  // (GATE_KEY_ORDER).
  const lines = [`${indent}- ${kind}: ${plainScalar(text)}`];
  const sub = indent + "  ";
  if (fields.description !== undefined) lines.push(`${sub}description: ${plainScalar(fields.description)}`);
  if (kind === "agent") {
    if (fields.guide !== undefined) lines.push(`${sub}guide: ${plainScalar(fields.guide)}`);
    if (fields.max_rounds !== undefined) lines.push(`${sub}max_rounds: ${fields.max_rounds}`);
  }
  if (fields.route_back_to !== undefined && fields.route_back_to.length > 0) lines.push(`${sub}route_back_to: ${routeBackValue(fields.route_back_to)}`);
  return lines.join("\n");
}

function ensureGateList(text: string, stepIndex: number): { text: string; doc: YAML.Document.Parsed; step: InstanceType<typeof YAMLMap> } {
  const doc = parseDoc(text);
  const step = stepMap(doc, stepIndex);
  const pair = findPair(step, "gates");
  if (!pair || !pair.value) return { text, doc, step };
  if (isSeq(pair.value)) {
    if (!pair.value.flow || pair.value.items.length === 0) return { text, doc, step };
    const newText = flowListAsBlock(text, stepIndex, "gates");
    const newDoc = parseDoc(newText);
    return { text: newText, doc: newDoc, step: stepMap(newDoc, stepIndex) };
  }
  // A single gate, as a mapping or a string: a one-item list, with the gate
  // itself kept as written.
  const newText = singletonAsList(text, stepIndex, "gates");
  const newDoc = parseDoc(newText);
  return { text: newText, doc: newDoc, step: stepMap(newDoc, stepIndex) };
}

function gateMapsOf(step: InstanceType<typeof YAMLMap>): InstanceType<typeof YAMLSeq> | undefined {
  const pair = findPair(step, "gates");
  if (!pair || !pair.value || !isSeq(pair.value)) return undefined;
  return pair.value;
}

function applyAddGate(text: string, edit: { step: number; gate: { kind: GateKind; text: string } }): string {
  const normalized = ensureGateList(text, edit.step);
  text = normalized.text;
  const { step } = normalized;
  const pair = findPair(step, "gates");
  const fieldLevelIndent = fieldIndent(text, step);
  const seqForIndent = pair && pair.value && isSeq(pair.value) ? pair.value : undefined;
  const itemIndent = seqForIndent && seqForIndent.items.length > 0 ? dashIndent(text, (seqForIndent.items[0] as { range?: Range }).range![0]) : fieldLevelIndent + "  ";
  const entry = gateLines(itemIndent, edit.gate.kind, edit.gate.text, {});

  if (!pair || !pair.value) {
    const rendered = `${fieldLevelIndent}gates:\n${entry}`;
    const splice = insertKeySplice(text, step, STEP_KEY_ORDER, "gates", rendered);
    return applySplices(text, [splice]);
  }
  const seq = pair.value;
  if (!isSeq(seq)) fail("internal error: gates is not a list after normalization");
  if (seq.items.length === 0) return fillEmptyList(text, step, "gates", entry);
  const lastItem = seq.items[seq.items.length - 1];
  const lastRange = (lastItem as { range?: Range }).range as Range;
  const insertAt = lineEndOf(text, lastRange[1] - 1 >= lastRange[0] ? lastRange[1] - 1 : lastRange[0]);
  return applySplices(text, [{ start: insertAt, end: insertAt, insert: entry + "\n" }]);
}

function applyRemoveGate(text: string, edit: { step: number; index: number }): string {
  const normalized = ensureGateList(text, edit.step);
  text = normalized.text;
  const { step } = normalized;
  const seq = gateMapsOf(step);
  if (!seq) fail("step has no gates list");
  const item = seq.items[edit.index];
  if (!item) fail(`gate index ${edit.index} is out of range`);

  if (seq.items.length === 1) {
    return applySplices(text, [removeKeySplice(text, step, "gates")]);
  }
  const { start, end } = itemFullRange(text, item as { range?: Range });
  return applySplices(text, [{ start, end, insert: "" }]);
}

// Read a gate list item (mapping or string) into its logical fields,
// resolving string form the same way the engine's gate schema does, well
// enough to re-render it. Used by setGate when it must rewrite the whole
// entry (kind change, or a string-form gate being edited for the first
// time).
function readGateItem(item: InstanceType<typeof YAMLMap> | InstanceType<typeof Scalar>): { kind: GateKind; text: string; description?: string; route_back_to: string[]; max_rounds?: number; guide?: string } {
  if (isMap(item)) {
    const kindEntry = item.items.find((p) => isScalar(p.key) && (["owner-action", "check", "script", "agent"] as const).includes(String(p.key.value) as GateKind));
    if (!kindEntry || !isScalar(kindEntry.key) || !isScalar(kindEntry.value)) fail("internal error: gate mapping has no kind key");
    const kind = String(kindEntry.key.value) as GateKind;
    const gateText = String(kindEntry.value.value);
    const description = scalarOf(item, "description");
    const guide = scalarOf(item, "guide");
    const maxRoundsRaw = findPair(item, "max_rounds")?.value;
    const max_rounds = isScalar(maxRoundsRaw) && typeof maxRoundsRaw.value === "number" ? maxRoundsRaw.value : undefined;
    const rbtValue = findPair(item, "route_back_to")?.value;
    let route_back_to: string[] = [];
    if (isScalar(rbtValue)) route_back_to = [String(rbtValue.value)];
    else if (isSeq(rbtValue)) route_back_to = rbtValue.items.filter(isScalar).map((s) => String(s.value));
    return { kind, text: gateText, description, route_back_to, max_rounds, guide };
  }
  // String form, e.g. `script("bun run check")` or `check: default`.
  const raw = String(item.value).trim();
  const m = /^([a-z-]+)\s*(?:\(\s*"?(.*?)"?\s*\)|:(.*))$/s.exec(raw);
  if (!m) fail(`cannot read gate string "${raw}"`);
  const kind = m[1] as GateKind;
  const gateText = (m[2] ?? m[3] ?? "").trim();
  return { kind, text: gateText, route_back_to: [] };
}

function gateItemAt(step: InstanceType<typeof YAMLMap>, index: number): InstanceType<typeof YAMLMap> | InstanceType<typeof Scalar> | undefined {
  const value = findPair(step, "gates")?.value;
  if (isMap(value) || isScalar(value)) return index === 0 ? value : undefined;
  if (isSeq(value)) {
    const item = value.items[index];
    return isMap(item) || isScalar(item) ? item : undefined;
  }
  return undefined;
}

function patchGate(current: ReturnType<typeof readGateItem>, fields: GateFields): ReturnType<typeof readGateItem> {
  const next = { ...current };
  if (fields.kind !== undefined) next.kind = fields.kind;
  if (fields.text !== undefined) next.text = fields.text;
  if ("description" in fields) next.description = fields.description === null ? undefined : fields.description;
  if ("max_rounds" in fields) next.max_rounds = fields.max_rounds === null ? undefined : fields.max_rounds;
  if ("guide" in fields) next.guide = fields.guide === null ? undefined : fields.guide;
  if (fields.route_back_to !== undefined) next.route_back_to = fields.route_back_to;
  if (next.kind !== "agent") {
    next.max_rounds = undefined;
    next.guide = undefined;
  }
  return next;
}

// One route_back_to target as a scalar, several as a flow list.
function routeBackValue(targets: string[]): string {
  return targets.length === 1 ? plainScalar(targets[0]) : flowList(targets);
}

// The keys of a gate mapping, in the order new keys are inserted: the kind
// key first (only one of the four is ever present).
const GATE_KEY_ORDER = ["owner-action", "check", "script", "agent", "description", "guide", "max_rounds", "route_back_to"] as const;

// The gate mapping at `index` of an already-normalized gates list.
function gateMapAt(text: string, stepIndex: number, index: number): InstanceType<typeof YAMLMap> {
  const seq = gateMapsOf(stepMap(parseDoc(text), stepIndex));
  const item = seq?.items[index];
  if (!isMap(item)) fail(`gate index ${index} is not a gate mapping`);
  return item;
}

// Set, replace or remove one key of a gate mapping, leaving its other lines
// (and their comments) as they are. `rendered` is the value as YAML source,
// or null to remove the key.
function setGateKey(text: string, stepIndex: number, index: number, key: (typeof GATE_KEY_ORDER)[number], rendered: string | null): string {
  const gate = gateMapAt(text, stepIndex, index);
  const pair = findPair(gate, key);
  if (rendered === null) return pair ? applySplices(text, [removeKeySplice(text, gate, key)]) : text;
  if (pair && pair.value && (isScalar(pair.value) || isSeq(pair.value))) {
    const range = pair.value.range as Range;
    if (text.slice(range[0], range[1]) === rendered) return text;
    return applySplices(text, [{ start: range[0], end: range[1], insert: rendered }]);
  }
  const indent = fieldIndent(text, gate);
  return applySplices(text, [insertKeySplice(text, gate, GATE_KEY_ORDER, key, `${indent}${key}: ${rendered}`)]);
}

function applySetGate(text: string, edit: { step: number; index: number; fields: GateFields }): string {
  const originalStep = stepMap(parseDoc(text), edit.step);
  const originalItem = gateItemAt(originalStep, edit.index);
  if (!originalItem) fail(`gate index ${edit.index} is out of range`);
  const current = readGateItem(originalItem);
  const next = patchGate(current, edit.fields);
  if (JSON.stringify(current) === JSON.stringify(next)) return text;

  // A gate inside a flow list (`gates: [{ agent: review }, ...]`) is written
  // again as one flow mapping, in its place; the rest of the list is untouched.
  const gatesValue = findPair(originalStep, "gates")?.value;
  if (isSeq(gatesValue) && gatesValue.flow) {
    const parts = [`${next.kind}: ${plainScalar(next.text)}`];
    if (next.description !== undefined) parts.push(`description: ${plainScalar(next.description)}`);
    if (next.guide !== undefined) parts.push(`guide: ${plainScalar(next.guide)}`);
    if (next.max_rounds !== undefined) parts.push(`max_rounds: ${next.max_rounds}`);
    if (next.route_back_to.length) parts.push(`route_back_to: ${routeBackValue(next.route_back_to)}`);
    const r = (originalItem as { range: Range }).range;
    return applySplices(text, [{ start: r[0], end: r[1], insert: `{ ${parts.join(", ")} }` }]);
  }

  const normalized = ensureGateList(text, edit.step);
  text = normalized.text;
  const seq = gateMapsOf(normalized.step);
  if (!seq) fail("step has no gates list");
  const item = seq.items[edit.index];
  if (!isMap(item) && !isScalar(item)) fail(`gate index ${edit.index} is out of range`);

  // A gate in string form is rewritten as a mapping the first time it is
  // edited (decision 15).
  if (isScalar(item)) {
    const indent = dashIndent(text, (item.range as Range)[0]);
    const rendered = gateLines(indent, next.kind, next.text, next);
    const range = item.range as Range;
    // `rendered` starts with "<indent>- "; item.range[0] starts right after
    // that marker, so only the part from there on is the replacement.
    return applySplices(text, [replacementSplice(text, range[0], range[1], rendered.slice(indent.length + 2))]);
  }

  // A mapping: change only the keys whose value changed.
  if (next.kind !== current.kind || next.text !== current.text) {
    const kindPair = item.items.find((p) => isScalar(p.key) && String(p.key.value) === current.kind)!;
    const keyRange = (kindPair.key as InstanceType<typeof Scalar>).range as Range;
    const valueRange = (kindPair.value as InstanceType<typeof Scalar>).range as Range;
    text = applySplices(text, [{ start: keyRange[0], end: valueRange[1], insert: `${next.kind}: ${plainScalar(next.text)}` }]);
  }
  const value = (v: string | undefined) => (v === undefined ? null : plainScalar(v));
  if (next.description !== current.description) text = setGateKey(text, edit.step, edit.index, "description", value(next.description));
  if (next.guide !== current.guide) text = setGateKey(text, edit.step, edit.index, "guide", value(next.guide));
  if (next.max_rounds !== current.max_rounds) {
    text = setGateKey(text, edit.step, edit.index, "max_rounds", next.max_rounds === undefined ? null : String(next.max_rounds));
  }
  if (JSON.stringify(next.route_back_to) !== JSON.stringify(current.route_back_to)) {
    text = setGateKey(text, edit.step, edit.index, "route_back_to", next.route_back_to.length ? routeBackValue(next.route_back_to) : null);
  }
  return text;
}

// ---------------------------------------------------------------------------
// insertStep, deleteStep, moveStep

function stepLines(indent: string, step: { id: string; instruction: string }): string {
  const lines = [`${indent}- id: ${plainScalar(step.id)}`];
  if (shouldUsePlainScalar(step.instruction)) {
    lines.push(`${indent}  instruction: ${plainScalar(step.instruction)}`);
  } else {
    lines.push(blockScalarLines("instruction", indent + "  ", step.instruction, ">"));
  }
  return lines.join("\n").replace(/\n$/, "");
}

// A list item's lines: from its "- " line, widened over the comment lines
// directly above it at the dash's own column, which belong to it and move or
// go with it, to its last line. A comment indented deeper belongs to the
// previous item's fields and stays with that item.
function itemFullRange(text: string, item: { range?: Range | null }): { start: number; end: number } {
  const range = item.range as Range;
  let start = lineStartOf(text, range[0]);
  const dashColumn = dashIndent(text, range[0]).length;
  while (start > 0) {
    const prevStart = lineStartOf(text, start - 1);
    const prev = text.slice(prevStart, start - 1);
    if (!/^\s*#/.test(prev) || prev.length - prev.trimStart().length !== dashColumn) break;
    start = prevStart;
  }
  const end = lineEndOf(text, range[1] - 1 >= range[0] ? range[1] - 1 : range[0]);
  return { start, end };
}

function applyInsertStep(text: string, edit: { at: number; step: { id: string; instruction: string } }): string {
  text = blockSteps(text);
  const doc = parseDoc(text);
  const seq = stepsSeq(doc);
  if (edit.at < 0 || edit.at > seq.items.length) fail(`insert index ${edit.at} is out of range (workflow has ${seq.items.length} steps)`);
  for (const other of seq.items) {
    if (isMap(other) && stepIdOf(other) === edit.step.id) fail(`step id "${edit.step.id}" is already used`);
  }

  const itemIndent = seq.items[0] ? dashIndent(text, (seq.items[0] as { range?: Range }).range![0]) : "  ";
  const rendered = stepLines(itemIndent, edit.step) + "\n";

  if (seq.items.length === 0) {
    // `steps: []` (or an empty block): the new step becomes the whole list.
    const pair = findPair(rootMap(doc), "steps")!;
    const keyEnd = ((pair.key as InstanceType<typeof Scalar>).range as Range)[1];
    const end = (seq.range as Range)[1];
    return applySplices(text, [{ start: keyEnd, end, insert: `:\n${rendered.replace(/\n$/, "")}` }]);
  }
  if (edit.at === seq.items.length) {
    const last = itemFullRange(text, seq.items[seq.items.length - 1] as { range?: Range });
    return applySplices(text, [{ start: last.end, end: last.end, insert: rendered }]);
  }
  const target = itemFullRange(text, seq.items[edit.at] as { range?: Range });
  return applySplices(text, [{ start: target.start, end: target.start, insert: rendered }]);
}

function applyDeleteStep(text: string, edit: { index: number }): string {
  text = blockSteps(text);
  const doc = parseDoc(text);
  const seq = stepsSeq(doc);
  const item = seq.items[edit.index];
  if (!item) fail(`step index ${edit.index} is out of range (workflow has ${seq.items.length} steps)`);
  if (seq.items.length === 1) fail("a workflow needs at least one step");
  const { start, end } = itemFullRange(text, item as { range?: Range });
  return applySplices(text, [{ start, end, insert: "" }]);
}

function applyMoveStep(text: string, edit: { from: number; to: number }): string {
  if (edit.from === edit.to) return text;
  text = blockSteps(text);
  const doc = parseDoc(text);
  const seq = stepsSeq(doc);
  const fromItem = seq.items[edit.from];
  if (!fromItem) fail(`step index ${edit.from} is out of range (workflow has ${seq.items.length} steps)`);
  if (edit.to < 0 || edit.to >= seq.items.length) fail(`step index ${edit.to} is out of range (workflow has ${seq.items.length} steps)`);
  if (edit.from === edit.to) return text;

  const fromRange = itemFullRange(text, fromItem as { range?: Range });
  const block = text.slice(fromRange.start, fromRange.end);
  const withoutBlock = text.slice(0, fromRange.start) + text.slice(fromRange.end);

  // Recompute the target position in the text with the moved block removed.
  const doc2 = parseDoc(withoutBlock);
  const seq2 = stepsSeq(doc2);
  // In the reduced list, inserting before index `to` produces the requested
  // final index. When `to` equals the reduced length, append at the end.
  if (edit.to >= seq2.items.length) {
    const last = itemFullRange(withoutBlock, seq2.items[seq2.items.length - 1] as { range?: Range });
    return applySplices(withoutBlock, [{ start: last.end, end: last.end, insert: block }]);
  }
  const targetItem = seq2.items[edit.to];
  const target = itemFullRange(withoutBlock, targetItem as { range?: Range });
  return applySplices(withoutBlock, [{ start: target.start, end: target.start, insert: block }]);
}

// ---------------------------------------------------------------------------
// Dispatch

export function applyEdit(text: string, edit: Edit): string {
  switch (edit.op) {
    case "setWorkflowField":
      return applySetWorkflowField(text, edit);
    case "setStepField":
      return applySetStepField(text, edit);
    case "setInstruction":
      return applySetInstruction(text, edit);
    case "setCondition":
      return applySetCondition(text, edit);
    case "setConsumes":
      return applySetConsumes(text, edit);
    case "addOutput":
      return applyAddOutput(text, edit);
    case "removeOutput":
      return applyRemoveOutput(text, edit);
    case "setOutput":
      return applySetOutput(text, edit);
    case "changeOutputMode":
      return applyChangeOutputMode(text, edit);
    case "addGate":
      return applyAddGate(text, edit);
    case "removeGate":
      return applyRemoveGate(text, edit);
    case "setGate":
      return applySetGate(text, edit);
    case "insertStep":
      return applyInsertStep(text, edit);
    case "deleteStep":
      return applyDeleteStep(text, edit);
    case "moveStep":
      return applyMoveStep(text, edit);
    default: {
      const _exhaustive: never = edit;
      throw new EditError(`unknown edit op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
