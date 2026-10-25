// SPDX-License-Identifier: Apache-2.0
import { ApiError } from './api';
import type {
  DiagnosticView,
  Session,
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

function parseDiagnostic(value: unknown): DiagnosticView {
  const diagnostic = objectOf(value);
  const line = diagnostic.line;
  return {
    message: stringOf(diagnostic.message),
    line: typeof line === 'number' ? line : 0,
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
  return {
    name: stringOf(document.name),
    text: text === null ? null : stringOf(text),
    view: parseView(document.view),
    diagnostics: arrayOf(document.diagnostics).map(parseDiagnostic),
  };
}

/** The sentence of an `Error` body, or `undefined` when it has none. */
export function errorMessageOf(body: unknown): string | undefined {
  return isObject(body) && typeof body.error === 'string'
    ? body.error
    : undefined;
}

/** The `code` of an `Error` body, or `undefined` when it has none. */
export function errorCodeOf(body: unknown): string | undefined {
  return isObject(body) && typeof body.code === 'string'
    ? body.code
    : undefined;
}
