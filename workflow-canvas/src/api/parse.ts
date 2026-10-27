// SPDX-License-Identifier: Apache-2.0
import { ApiError } from './api';
import type {
  CheckResult,
  DiagnosticView,
  RunStageView,
  RunStatus,
  RunView,
  SaveResult,
  Session,
  Severity,
  StageRunStatus,
  StageView,
  WorkflowDocument,
  WorkflowView,
} from './types';

type Json = Record<string, unknown>;

const BAD_REPLY = 'The server sent a reply that this page does not understand.';

function fail(): never {
  throw new ApiError(BAD_REPLY, 200);
}

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

function parseStage(value: unknown): StageView {
  const stage = objectOf(value);
  return { name: stringOf(stage.name), agent: stringOf(stage.agent) };
}

function parseView(value: unknown): WorkflowView | null {
  if (value === null) return null;
  const view = objectOf(value);
  return {
    name: stringOf(view.name),
    intent: { outcome: stringOf(objectOf(view.intent).outcome) },
    stages: arrayOf(view.stages).map(parseStage),
  };
}

// The contract requires a line of 1 or more; anything else is left out
// rather than shown as a line that does not exist.
function lineOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
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

// The stages in `order`, each with its status from `stages`.
function parseRunStages(order: unknown, stages: unknown): RunStageView[] {
  const byName = objectOf(stages);
  return arrayOf(order).map((entry) => {
    const name = stringOf(entry);
    const stage = Object.hasOwn(byName, name) ? byName[name] : fail();
    return {
      name,
      status: oneOf(objectOf(stage).status, STAGE_STATUSES),
    };
  });
}

/** Reads a `RunStarted`: the id of the run that was accepted. */
export function parseRunStarted(body: unknown): string {
  return stringOf(objectOf(body).run_id);
}

/** Reads a `RunStatusResponse`; unknown fields are ignored. */
export function parseRunStatus(body: unknown): RunView {
  const run = objectOf(objectOf(body).run);
  const exitCode = run.exit_code;
  return {
    runId: stringOf(run.run_id),
    status: oneOf(run.status, RUN_STATUSES),
    exitCode: typeof exitCode === 'number' ? exitCode : null,
    stages: parseRunStages(run.order, run.stages),
  };
}

/** Reads a `SessionResponse`; unknown fields are ignored. */
export function parseSession(body: unknown): Session {
  const session = objectOf(body);
  const version = session.api_version;
  return {
    token: stringOf(session.token),
    root: stringOf(session.root),
    harness: stringOf(session.harness),
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

/** The sentence of an `Error` body, or `undefined` when it has none. */
export function errorMessageOf(body: unknown): string | undefined {
  return isObject(body) && typeof body.error === 'string'
    ? body.error
    : undefined;
}

/** The `run_id` of an `Error` body, or `undefined` when it has none. */
export function errorRunIdOf(body: unknown): string | undefined {
  return isObject(body) && typeof body.run_id === 'string' && body.run_id !== ''
    ? body.run_id
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
