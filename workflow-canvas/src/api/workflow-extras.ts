// SPDX-License-Identifier: Apache-2.0
import { ApiError } from './api';

/*
 * The fields of `GET /api/workflow` that `parse.ts` leaves out: the `kind`
 * and `range` of each stage, the `stage_fields` of the document, and the
 * default goal of the workflow. It reads the same answer and rejects a shape
 * the contract does not allow, as `parse.ts` does, so a view built on it
 * never shows a field the server did not send.
 */

const BAD_REPLY = 'The server sent a reply that this page does not understand.';

function fail(): never {
  throw new ApiError(BAD_REPLY, 200);
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectOf(value: unknown): Json {
  return isObject(value) ? value : fail();
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : fail();
}

function booleanOf(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}

function lineOf(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 1
    ? (value as number)
    : fail();
}

function countOf(value: unknown, least: number): number {
  return Number.isInteger(value) && (value as number) >= least
    ? (value as number)
    : fail();
}

function stringsOf(value: unknown): readonly string[] {
  return arrayOf(value).map(stringOf);
}

// A key the contract does not list is left out, and a key that is there with
// the wrong shape is a bad reply.
function optional<T>(
  holder: Json,
  key: string,
  read: (value: unknown) => T,
): { readonly [k: string]: T } {
  return Object.hasOwn(holder, key) ? { [key]: read(holder[key]) } : {};
}

/** The lines of the workflow text that a stage takes up, counted from 1. */
export interface StageRange {
  /** The line of the stage's first key. */
  readonly line: number;
  /** The line where its last value ends, included. */
  readonly endLine: number;
}

/** The `kind` and `range` of one stage of the view. */
export interface StageExtras {
  readonly name: string;
  /**
   * The key of the file that names the kind of the stage. A kind this page
   * does not know is kept as it came, so a caller can draw the stage plainly.
   */
  readonly kind: string;
  readonly range: StageRange;
}

/**
 * One editable key of a stage, the `StageField` of `stage_fields`. The keys
 * are those of the wire, so the form rules take it as it is. A rule that is
 * left out does not apply.
 */
export interface StageFieldInfo {
  readonly key: string;
  /** `name`, `text` or `path`. A type a later version adds is shown as text. */
  readonly type: string;
  readonly required: boolean;
  readonly min_length?: number;
  readonly max_length?: number;
  /** A regular expression that the whole value matches. */
  readonly pattern?: string;
  /** Values the key may not take. */
  readonly reserved?: readonly string[];
  /** Keys that a stage may not have together with this one. */
  readonly excludes?: readonly string[];
}

/** The fields of the answer that the parsed document leaves out. */
export interface WorkflowExtras {
  /** One entry per stage of the view, in run order; empty when there is no view. */
  readonly stages: readonly StageExtras[];
  /** The editable keys of a stage, by kind. It is there even with no view. */
  readonly stageFields: Readonly<Record<string, readonly StageFieldInfo[]>>;
  /** The default goal the workflow declares, when it declares one. */
  readonly goalDefault?: string;
}

function parseRange(value: unknown): StageRange {
  const range = objectOf(value);
  const line = lineOf(range.line);
  const endLine = lineOf(range.end_line);
  // A stage ends where it starts or later; the other way round is a bad reply.
  return endLine >= line ? { line, endLine } : fail();
}

function parseStage(value: unknown): StageExtras {
  const stage = objectOf(value);
  return {
    name: stringOf(stage.name),
    kind: stringOf(stage.kind),
    range: parseRange(stage.range),
  };
}

// The graph names its nodes by stage name, so a name that repeats would hide
// a stage, as it would in `parse.ts`.
function uniqueByName(stages: readonly StageExtras[]): readonly StageExtras[] {
  const names = new Set(stages.map((stage) => stage.name));
  return names.size === stages.length ? stages : fail();
}

function parseField(value: unknown): StageFieldInfo {
  const field = objectOf(value);
  return {
    key: stringOf(field.key),
    type: stringOf(field.type),
    required: booleanOf(field.required),
    ...optional(field, 'min_length', (v) => countOf(v, 0)),
    ...optional(field, 'max_length', (v) => countOf(v, 1)),
    ...optional(field, 'pattern', stringOf),
    ...optional(field, 'reserved', stringsOf),
    ...optional(field, 'excludes', stringsOf),
  };
}

function parseFieldList(value: unknown): readonly StageFieldInfo[] {
  const fields = arrayOf(value).map(parseField);
  return fields.length > 0 ? fields : fail();
}

// Every kind of `stage_fields` is a list of keys, the kinds of a later
// version included, and the contract always sends the `agent` kind.
function parseStageFields(
  value: unknown,
): Readonly<Record<string, readonly StageFieldInfo[]>> {
  const byKind = objectOf(value);
  if (!Object.hasOwn(byKind, 'agent')) fail();
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, fields]) => [
      kind,
      parseFieldList(fields),
    ]),
  );
}

// `params.goal.default`, when the workflow declares it. Every other param is
// left alone: this version runs with the goal only.
function parseGoalDefault(view: Json): { readonly goalDefault?: string } {
  if (!Object.hasOwn(view, 'params')) return {};
  const params = objectOf(view.params);
  if (!Object.hasOwn(params, 'goal')) return {};
  const goal = objectOf(params.goal);
  if (!Object.hasOwn(goal, 'default')) return {};
  return { goalDefault: stringOf(goal.default) };
}

/**
 * Reads the `kind` and `range` of each stage, the `stage_fields` and the
 * default goal out of a `WorkflowDocument` body. A `view` of `null` has no
 * stages and no default goal; `stage_fields` is there either way. Unknown
 * fields are ignored, and a field the contract shapes differently throws an
 * `ApiError`, as reading the rest of the answer does.
 */
export function parseWorkflowExtras(body: unknown): WorkflowExtras {
  const document = objectOf(body);
  const stageFields = parseStageFields(document.stage_fields);
  if (document.view === null) return { stages: [], stageFields };
  const view = objectOf(document.view);
  return {
    stages: uniqueByName(arrayOf(view.stages).map(parseStage)),
    stageFields,
    ...parseGoalDefault(view),
  };
}

/** The `kind` and `range` of the stage called `name`, when the view has it. */
export function stageExtrasOf(
  extras: WorkflowExtras,
  name: string,
): StageExtras | undefined {
  return extras.stages.find((stage) => stage.name === name);
}

/**
 * The editable keys of a stage of `kind`, or none for a kind the server did
 * not describe, so a caller shows such a stage without a form.
 */
export function stageFieldsOf(
  extras: WorkflowExtras,
  kind: string,
): readonly StageFieldInfo[] {
  const fields = Object.hasOwn(extras.stageFields, kind)
    ? extras.stageFields[kind]
    : undefined;
  return fields ?? [];
}
