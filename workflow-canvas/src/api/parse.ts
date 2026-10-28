// SPDX-License-Identifier: Apache-2.0
import { ApiError } from './api';
import type {
  DiagnosticView,
  RunStageView,
  RunStatus,
  RunView,
  Session,
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

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}

// The contract has `exit_code` as an integer or null, and requires the key.
function exitCodeOf(value: unknown): number | null {
  return value === null || Number.isInteger(value)
    ? (value as number | null)
    : fail();
}

function parseStage(value: unknown): StageView {
  const stage = objectOf(value);
  return { name: stringOf(stage.name), agent: stringOf(stage.agent) };
}

// The contract forbids two stages with one name, and the graph names its
// nodes by stage name, so a repeat would silently hide a stage.
function uniqueByName(stages: StageView[]): StageView[] {
  const names = new Set(stages.map((stage) => stage.name));
  return names.size === stages.length ? stages : fail();
}

function parseView(value: unknown): WorkflowView | null {
  if (value === null) return null;
  const view = objectOf(value);
  return {
    name: stringOf(view.name),
    intent: { outcome: stringOf(objectOf(view.intent).outcome) },
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

function parseDiagnostic(value: unknown): DiagnosticView {
  const diagnostic = objectOf(value);
  return {
    message: stringOf(diagnostic.message),
    line: lineOf(diagnostic.line),
  };
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

// The stages in `order`, each with its status from `stages`. The contract
// lists each stage once, so a name that repeats is a bad reply.
function parseRunStages(order: unknown, stages: unknown): RunStageView[] {
  const byName = objectOf(stages);
  const seen = new Set<string>();
  const listed = arrayOf(order).map((entry) => {
    const name = stringOf(entry);
    if (seen.has(name)) fail();
    seen.add(name);
    const stage = Object.hasOwn(byName, name) ? byName[name] : fail();
    return {
      name,
      status: oneOf(objectOf(stage).status, STAGE_STATUSES),
    };
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

/** Reads a `RunStarted`: the id of the run that was accepted. */
export function parseRunStarted(body: unknown): string {
  return runIdOf(objectOf(body).run_id);
}

/** Reads a `RunStatusResponse`; unknown fields are ignored. */
export function parseRunStatus(body: unknown): RunView {
  const run = objectOf(objectOf(body).run);
  const view: RunView = {
    runId: runIdOf(run.run_id),
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
    harness: stringOf(session.harness),
    apiVersion: typeof version === 'number' ? version : fail(),
  };
}

/** Reads a `WorkflowDocument`; unknown fields are ignored. */
export function parseWorkflowDocument(body: unknown): WorkflowDocument {
  const document = objectOf(body);
  const text = document.text;
  return {
    name: stringOf(document.name),
    text: text === null ? null : stringOf(text),
    view: parseView(document.view),
    diagnostics: arrayOf(document.diagnostics).map(parseDiagnostic),
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
