// SPDX-License-Identifier: Apache-2.0
import {
  arrayOf,
  booleanOf,
  fail,
  objectOf,
  stringOf,
  type Json,
} from './parse';

/*
 * The fields of `GET /api/workflow` that `parse.ts` leaves out and the views
 * read when the workflow is loaded: the `stage_fields` of the document, the
 * default goal of the workflow and the params it declares. It reads the same
 * answer with the same readers as `parse.ts`, and rejects a shape the
 * contract does not allow, so a view built on it never shows a field the
 * server did not send.
 *
 * The `kind` and the `range` of a stage are not here: they change with every
 * edit, so the Design view reads them from the answer of the check it just
 * made, and one reader of them is enough.
 */

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

/**
 * One editable key of a stage, the `StageField` of `stage_fields` in
 * `api/openapi.yaml`. The keys are those of the wire, so the form rules take
 * it as it is: `designer-view/field-rules.ts` names this same type
 * `StageFieldRule`. A rule that is left out does not apply.
 */
export interface StageField {
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

/**
 * One input of a run that the workflow declares beside the goal, the `Param`
 * of `api/openapi.yaml`. The goal is not one of these: it has its own box and
 * its own limit, and its default is read as `goalDefault`.
 */
export interface ParamDeclaration {
  readonly name: string;
  /** `string` in this version. A type a later version adds is shown as text. */
  readonly type?: string;
  readonly description?: string;
  /** The value a run takes when it sends none. */
  readonly default?: string;
  /** Whether a run must carry a value. It is false unless the file says so. */
  readonly required: boolean;
}

/** The fields of the answer that the parsed document leaves out. */
export interface WorkflowExtras {
  /** The editable keys of a stage, by kind. It is there even with no view. */
  readonly stageFields: Readonly<Record<string, readonly StageField[]>>;
  /** The default goal the workflow declares, when it declares one. */
  readonly goalDefault?: string;
  /** The params the workflow declares beside the goal, in the order of the file. */
  readonly params?: readonly ParamDeclaration[];
}

function parseField(value: unknown): StageField {
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

function parseFieldList(value: unknown): readonly StageField[] {
  const fields = arrayOf(value).map(parseField);
  return fields.length > 0 ? fields : fail();
}

// Every kind of `stage_fields` is a list of keys, the kinds of a later
// version included, and the contract always sends the `agent` kind.
function parseStageFields(
  value: unknown,
): Readonly<Record<string, readonly StageField[]>> {
  const byKind = objectOf(value);
  if (!Object.hasOwn(byKind, 'agent')) fail();
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, fields]) => [
      kind,
      parseFieldList(fields),
    ]),
  );
}

// `params.goal.default`, when the workflow declares it. The other params are
// read by `parseParams`.
function parseGoalDefault(view: Json): { readonly goalDefault?: string } {
  if (!Object.hasOwn(view, 'params')) return {};
  const params = objectOf(view.params);
  if (!Object.hasOwn(params, 'goal')) return {};
  const goal = objectOf(params.goal);
  if (!Object.hasOwn(goal, 'default')) return {};
  return { goalDefault: stringOf(goal.default) };
}

function parseParam(name: string, value: unknown): ParamDeclaration {
  const param = objectOf(value);
  return {
    name,
    required: Object.hasOwn(param, 'required')
      ? booleanOf(param.required)
      : false,
    ...optional(param, 'type', stringOf),
    ...optional(param, 'description', stringOf),
    ...optional(param, 'default', stringOf),
  };
}

// The params the workflow declares beside the goal. The server sends them in
// the order of the file, and a param name starts with a letter, so the keys
// of the answer keep that order.
function parseParams(view: Json): {
  readonly params?: readonly ParamDeclaration[];
} {
  if (!Object.hasOwn(view, 'params')) return {};
  const declared = Object.entries(objectOf(view.params))
    .filter(([name]) => name !== 'goal')
    .map(([name, value]) => parseParam(name, value));
  return declared.length > 0 ? { params: declared } : {};
}

/**
 * Reads the `stage_fields`, the default goal and the declared params out of a
 * `WorkflowDocument` body. A `view` of `null` has neither a default goal nor
 * params; `stage_fields` is there either way. Unknown fields are ignored, and
 * a field the contract shapes differently throws an `ApiError`, as reading
 * the rest of the answer does.
 */
export function parseWorkflowExtras(body: unknown): WorkflowExtras {
  const document = objectOf(body);
  const stageFields = parseStageFields(document.stage_fields);
  if (document.view === null) return { stageFields };
  const view = objectOf(document.view);
  return { stageFields, ...parseGoalDefault(view), ...parseParams(view) };
}
