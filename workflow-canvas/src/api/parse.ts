// SPDX-License-Identifier: Apache-2.0
import { ApiError } from './api';
import type {
  CheckResult,
  DiagnosticView,
  Harness,
  LineRange,
  ParamView,
  RunStageView,
  RunStatus,
  RunSummary,
  RunView,
  SaveResult,
  Session,
  Severity,
  StageField,
  StageFields,
  StageKind,
  StageRunStatus,
  StageView,
  WorkflowDocument,
  WorkflowView,
} from './types';

export type Json = Record<string, unknown>;

export const BAD_REPLY =
  'The server sent a reply that this page does not understand.';

export function fail(): never {
  throw new ApiError(BAD_REPLY, 200);
}

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function objectOf(value: unknown): Json {
  return isObject(value) ? value : fail();
}

export function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : fail();
}

export function booleanOf(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}

export function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}

// The contract has `exit_code` as an integer or null, and requires the key.
function exitCodeOf(value: unknown): number | null {
  return value === null || Number.isInteger(value)
    ? (value as number | null)
    : fail();
}

// Any string that is not empty: a kind the contract does not name yet is kept
// as it is, and the page draws it as a plain stage.
function kindOf(value: unknown): StageKind {
  return typeof value === 'string' && value !== '' ? value : fail();
}

// The contract requires both lines, as whole numbers of 1 or more.
function parseRange(value: unknown): LineRange {
  const range = objectOf(value);
  return {
    line: lineOf(range.line) ?? fail(),
    end_line: lineOf(range.end_line) ?? fail(),
  };
}

function stringMapOf(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectOf(value)).map(([key, entry]) => [
      key,
      stringOf(entry),
    ]),
  );
}

function parseStage(value: unknown): StageView {
  const stage = objectOf(value);
  const outcome =
    stage.outcome === undefined ? undefined : stringOf(stage.outcome);
  const prompt =
    stage.prompt === undefined ? undefined : stringOf(stage.prompt);
  const promptFile =
    stage.prompt_file === undefined ? undefined : stringOf(stage.prompt_file);
  const outputs =
    stage.outputs === undefined ? undefined : stringMapOf(stage.outputs);
  return {
    name: stringOf(stage.name),
    kind: kindOf(stage.kind),
    agent: stringOf(stage.agent),
    ...(outcome === undefined ? {} : { outcome }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(promptFile === undefined ? {} : { prompt_file: promptFile }),
    ...(outputs === undefined ? {} : { outputs }),
    range: parseRange(stage.range),
  };
}

// The contract forbids two stages with one name, and the graph names its
// nodes by stage name, so a repeat would silently hide a stage.
function uniqueByName(stages: StageView[]): StageView[] {
  const names = new Set(stages.map((stage) => stage.name));
  return names.size === stages.length ? stages : fail();
}

function optionalString(holder: Json, key: string): string | undefined {
  return Object.hasOwn(holder, key) ? stringOf(holder[key]) : undefined;
}

function parseParam(value: unknown): ParamView {
  const param = objectOf(value);
  const parsed: ParamView = {};
  const type = optionalString(param, 'type');
  const description = optionalString(param, 'description');
  const fallback = optionalString(param, 'default');
  if (type !== undefined) parsed.type = type;
  if (description !== undefined) parsed.description = description;
  if (fallback !== undefined) parsed.default = fallback;
  if (param.required !== undefined) parsed.required = booleanOf(param.required);
  return parsed;
}

// The key is left out when the reply has none. Object entry order is the
// declaration order the server read from the file.
function parseParams(value: unknown): Pick<WorkflowView, 'params'> {
  if (value === undefined) return {};
  const params = objectOf(value);
  return {
    params: Object.fromEntries(
      Object.entries(params).map(([name, param]) => [name, parseParam(param)]),
    ),
  };
}

function parseCheck(value: unknown) {
  const check = objectOf(value);
  const id = stringOf(check.id);
  const hasFile = Object.hasOwn(check, 'file');
  const hasRun = Object.hasOwn(check, 'run');
  if (hasFile === hasRun) fail();
  return hasFile
    ? { id, file: stringOf(check.file) }
    : { id, run: arrayOf(check.run).map(stringOf) };
}

export function parseIntent(value: unknown): WorkflowView['intent'] {
  const intent = objectOf(value);
  return {
    outcome: stringOf(intent.outcome),
    ...(intent.accept === undefined
      ? {}
      : { accept: arrayOf(intent.accept).map(parseCheck) }),
  };
}

function parseView(value: unknown): WorkflowView | null {
  if (value === null) return null;
  const view = objectOf(value);
  return {
    name: stringOf(view.name),
    intent: parseIntent(view.intent),
    ...parseParams(view.params),
    stages: uniqueByName(arrayOf(view.stages).map(parseStage)),
  };
}

// The contract requires a line of 1 or more; anything else is left out
// rather than shown as a line that does not exist.
function lineOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

// A whole number of at least `min`, or nothing when the key is left out.
function optionalInteger(value: unknown, min: number): number | undefined {
  if (value === undefined) return undefined;
  return Number.isInteger(value) && (value as number) >= min
    ? (value as number)
    : fail();
}

function optionalStrings(value: unknown): string[] | undefined {
  return value === undefined ? undefined : arrayOf(value).map(stringOf);
}

// The contract leaves out a rule that does not apply, so a rule is left out
// here too, and one of the wrong type is a bad reply. `type` is any string,
// as the contract lets a later version add types.
function parseStageField(value: unknown): StageField {
  const field = objectOf(value);
  const parsed: StageField = {
    key: stringOf(field.key),
    type: stringOf(field.type),
    required: booleanOf(field.required),
  };
  const minLength = optionalInteger(field.min_length, 0);
  const maxLength = optionalInteger(field.max_length, 1);
  const pattern =
    field.pattern === undefined ? undefined : stringOf(field.pattern);
  const reserved = optionalStrings(field.reserved);
  const excludes = optionalStrings(field.excludes);
  if (minLength !== undefined) parsed.min_length = minLength;
  if (maxLength !== undefined) parsed.max_length = maxLength;
  if (pattern !== undefined) parsed.pattern = pattern;
  if (reserved !== undefined) parsed.reserved = reserved;
  if (excludes !== undefined) parsed.excludes = excludes;
  return parsed;
}

// Only the kind this page knows is read; a later version may add kinds.
function parseStageFields(value: unknown): StageFields {
  return { agent: arrayOf(objectOf(value).agent).map(parseStageField) };
}

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

// A severity that a later version adds is taken as an error, so a finding of
// a kind this page cannot judge never reads as harmless.
function severityOf(value: unknown): Severity {
  return SEVERITIES.find((candidate) => candidate === value) ?? 'error';
}

function parseDiagnostic(value: unknown): DiagnosticView {
  const diagnostic = objectOf(value);
  return {
    message: stringOf(diagnostic.message),
    line: lineOf(diagnostic.line),
    path: typeof diagnostic.path === 'string' ? diagnostic.path : '',
    severity: severityOf(diagnostic.severity),
  };
}

function parseDiagnostics(value: unknown): DiagnosticView[] {
  return arrayOf(value).map(parseDiagnostic);
}

const RUN_STATUSES: readonly RunStatus[] = ['running', 'passed', 'halted'];
const STAGE_STATUSES: readonly StageRunStatus[] = [
  'pending',
  'running',
  'passed',
  'blocked',
];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return allowed.find((candidate) => candidate === value) ?? fail();
}

/**
 * Whether a value can be a harness: any string that is not empty. The page
 * only shows the harness, so a value the contract does not name yet is shown
 * as it is rather than refused.
 */
export function isHarness(value: unknown): value is Harness {
  return typeof value === 'string' && value !== '';
}

function harnessOf(value: unknown): Harness {
  return isHarness(value) ? value : fail();
}

// The reason of a blocked stage. A missing or empty one leaves the stage
// blocked with no reason, as the contract has a client treat a reason it does
// not know like any other blocked stage; a value that is not a string is a bad
// reply.
function reasonOf(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  return typeof value === 'string' ? value : fail();
}

// The stages in `order`, each with its status from `stages`. The contract
// lists each stage once, so a name that repeats is a bad reply.
function parseRunStages(order: unknown, stages: unknown): RunStageView[] {
  const byName = objectOf(stages);
  const seen = new Set<string>();
  const listed = arrayOf(order).map((entry) => {
    const name = stringOf(entry);
    if (seen.has(name)) fail();
    seen.add(name);
    const stage = objectOf(Object.hasOwn(byName, name) ? byName[name] : fail());
    const status = oneOf(stage.status, STAGE_STATUSES);
    // The contract gives a blocked stage a reason, and no other stage one. A
    // reason this page does not know is still a reason, shown as it is.
    if (status !== 'blocked') return { name, status };
    const reason = reasonOf(stage.reason);
    return reason === undefined ? { name, status } : { name, status, reason };
  });
  // `order` holds the keys of `stages`: a stage that is not listed is a bad reply.
  return Object.keys(byName).length === listed.length ? listed : fail();
}

// The pattern of `RunId` in the contract, which holds in this version.
const RUN_ID_PATTERN = /^[0-9]{8}-[0-9]{4}-[a-z0-9]{5}$/;

function runIdOf(value: unknown): string {
  const id = stringOf(value);
  return RUN_ID_PATTERN.test(id) ? id : fail();
}

// The contract says what a run in each status looks like: a running run has
// no exit code, a passed run has every stage passed and exit code 0, and a
// halted run has exactly one stage blocked and an exit code above 0.
function isCoherent(
  status: RunStatus,
  exitCode: number | null,
  stages: readonly RunStageView[],
): boolean {
  switch (status) {
    case 'running':
      return exitCode === null;
    case 'passed':
      return exitCode === 0 && stages.every((s) => s.status === 'passed');
    case 'halted':
      return (
        exitCode !== null &&
        exitCode > 0 &&
        stages.filter((s) => s.status === 'blocked').length === 1
      );
  }
}

function parseRunSummary(value: unknown): RunSummary {
  const run = objectOf(value);
  return {
    run_id: runIdOf(run.run_id),
    started_at: stringOf(run.started_at),
    status: oneOf(run.status, RUN_STATUSES),
    goal: stringOf(run.goal),
    goal_truncated: booleanOf(run.goal_truncated),
  };
}

/** Reads a `RunList`, newest first as the server sends it; unknown fields are ignored. */
export function parseRunList(body: unknown): RunSummary[] {
  return arrayOf(objectOf(body).runs).map(parseRunSummary);
}

/** Reads a `RunStarted`: the id of the run that was accepted. */
export function parseRunStarted(body: unknown): string {
  return runIdOf(objectOf(body).run_id);
}

/** Reads a `RunStatusResponse`; unknown fields are ignored. */
export function parseRunStatus(body: unknown): RunView {
  const run = objectOf(objectOf(body).run);
  const view: RunView = {
    runId: runIdOf(run.run_id),
    harness: harnessOf(run.harness),
    status: oneOf(run.status, RUN_STATUSES),
    exitCode: exitCodeOf(run.exit_code),
    stages: parseRunStages(run.order, run.stages),
  };
  return isCoherent(view.status, view.exitCode, view.stages) ? view : fail();
}

/** Reads a `SessionResponse`; unknown fields are ignored. */
export function parseSession(body: unknown): Session {
  const session = objectOf(body);
  const version = session.api_version;
  return {
    token: stringOf(session.token),
    root: stringOf(session.root),
    harness: harnessOf(session.harness),
    apiVersion: typeof version === 'number' ? version : fail(),
  };
}

/** Reads a `WorkflowDocument`; unknown fields are ignored. */
export function parseWorkflowDocument(body: unknown): WorkflowDocument {
  const document = objectOf(body);
  const text = document.text;
  const hash = document.hash;
  return {
    name: stringOf(document.name),
    text: text === null ? null : stringOf(text),
    hash: hash === null ? null : stringOf(hash),
    readOnly: booleanOf(document.read_only),
    view: parseView(document.view),
    diagnostics: parseDiagnostics(document.diagnostics),
    stageFields: parseStageFields(document.stage_fields),
  };
}

/** Reads a `SaveResponse`; unknown fields are ignored. */
export function parseSaveResult(body: unknown): SaveResult {
  const saved = objectOf(body);
  const view = parseView(saved.view);
  return {
    hash: stringOf(saved.hash),
    view: view ?? fail(),
    diagnostics: parseDiagnostics(saved.diagnostics),
  };
}

/** Reads a `CheckResponse`; unknown fields are ignored. */
export function parseCheckResult(body: unknown): CheckResult {
  const check = objectOf(body);
  return {
    view: parseView(check.view),
    diagnostics: parseDiagnostics(check.diagnostics),
  };
}

/**
 * The sentence of an `Error` body, followed by its `fix` (what to do about it),
 * or `undefined` when it has no sentence.
 */
export function errorMessageOf(body: unknown): string | undefined {
  if (!isObject(body) || typeof body.error !== 'string') return undefined;
  const fix = typeof body.fix === 'string' ? body.fix : '';
  return fix === '' ? body.error : `${body.error} ${fix}`;
}

/** The `run_id` of an `Error` body, or `undefined` when it has none or it is not a run id. */
export function errorRunIdOf(body: unknown): string | undefined {
  return isObject(body) &&
    typeof body.run_id === 'string' &&
    RUN_ID_PATTERN.test(body.run_id)
    ? body.run_id
    : undefined;
}

/** The `current_hash` of a 409 `Error` body, or `undefined` when it has none. */
export function errorCurrentHashOf(body: unknown): string | undefined {
  return isObject(body) &&
    typeof body.current_hash === 'string' &&
    body.current_hash !== ''
    ? body.current_hash
    : undefined;
}

/** The `fix` of an `Error` body, or `undefined` when it has none. */
export function errorFixOf(body: unknown): string | undefined {
  return isObject(body) && typeof body.fix === 'string' && body.fix !== ''
    ? body.fix
    : undefined;
}

/** The `code` of an `Error` body, or `undefined` when it has none. */
export function errorCodeOf(body: unknown): string | undefined {
  return isObject(body) && typeof body.code === 'string'
    ? body.code
    : undefined;
}

/**
 * The `diagnostics` of an `Error` body, or none when it has none or they
 * cannot be read: the sentence of the error is still shown.
 */
export function errorDiagnosticsOf(body: unknown): DiagnosticView[] {
  if (!isObject(body) || !Array.isArray(body.diagnostics)) return [];
  try {
    return parseDiagnostics(body.diagnostics);
  } catch {
    return [];
  }
}
