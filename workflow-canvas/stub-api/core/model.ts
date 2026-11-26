// SPDX-License-Identifier: Apache-2.0

/** The wire shapes of api/openapi.yaml that the core produces. */
export const DIAGNOSTIC_CODES = [
  'YAML_SYNTAX',
  'YAML_UNSUPPORTED',
  'NOT_A_MAPPING',
  'UNKNOWN_KEY',
  'DUPLICATE_KEY',
  'MISSING_KEY',
  'WRONG_TYPE',
  'INVALID_NAME',
  'RESERVED_NAME',
  'DUPLICATE_STAGE',
  'NAME_MISMATCH',
  'INVALID_VALUE',
  'UNSUPPORTED_FORMAT',
  'STAGE_KIND_MISSING',
  'STAGE_KIND_AMBIGUOUS',
  'NOT_SUPPORTED_BY_THIS_BUILD',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Diagnostic {
  code: DiagnosticCode;
  severity: 'error' | 'warning' | 'info';
  file: string;
  path: string;
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  message: string;
  suggestion?: string;
}

/**
 * A check of the intent: an `id` and exactly one of `file` and `run`, as the
 * contract requires. A `file` check passes when that file exists, a `run`
 * check when its command exits 0. Running one is the runner's work, not the
 * stub's. The other key is typed `never`, so a check with both kinds, or
 * with neither, does not compile.
 */
export type Check =
  | { id: string; file: string; run?: never }
  | {
      id: string;
      /** A command and its arguments, run with no shell. */
      run: string[];
      file?: never;
    };

/** Whether the server has run a check yet. */
export const CHECK_STATES = ['verified', 'deferred'] as const;

export type CheckState = (typeof CHECK_STATES)[number];

/** One input of a run. Every value is a string in this release. */
export interface Param {
  type?: 'string';
  description?: string;
  default?: string;
  required?: boolean;
}

export interface Intent {
  outcome: string;
  accept?: Check[];
}

/** The key that names the kind of a stage. This build knows one. */
export type StageKind = 'agent';

/** The lines of the text that a stage takes up, counted from 1, both included. */
export interface LineRange {
  line: number;
  end_line: number;
}

export interface Stage {
  name: string;
  kind: StageKind;
  agent: string;
  prompt?: string;
  prompt_file?: string;
  /** The files the stage must leave behind, by output name, in file order. */
  outputs?: Record<string, string>;
  /** The ids of the checks that must pass before the stage does, in file order. */
  done_when?: string[];
  range: LineRange;
}

/** The parsed text: the keys of the file, with `name` filled in. */
export interface WorkflowView {
  format: string;
  version: string;
  name: string;
  intent: Intent;
  params?: Record<string, Param>;
  stages: Stage[];
}

export interface CheckResult {
  errors: number;
  warnings: number;
  infos: number;
  view: WorkflowView | null;
  diagnostics: Diagnostic[];
  summary: { valid: boolean; counts: { stages: number } };
}

/** One key of a stage that a person edits, and what it takes. */
export interface StageField {
  key: string;
  type: 'name' | 'text' | 'path';
  required: boolean;
  min_length?: number;
  max_length?: number;
  pattern?: string;
  reserved?: string[];
  excludes?: string[];
}

export type StageFields = Record<StageKind, StageField[]>;

export interface WorkflowDocument {
  name: string;
  text: string | null;
  hash: string | null;
  read_only: boolean;
  view: WorkflowView | null;
  diagnostics: Diagnostic[];
  stage_fields: StageFields;
}

export interface SaveResult {
  hash: string;
  view: WorkflowView;
  diagnostics: Diagnostic[];
}

/** Why a stage is blocked. */
export const STAGE_REASONS = [
  'RESULT_MISSING',
  'RESULT_INVALID',
  'RESULT_FAILURE',
  'SESSION_FAILED',
  'TIMEOUT',
  'OUTPUT_MISSING',
  'OUTPUT_UNCHANGED',
  'CHECK_FAILED',
] as const;

export type StageReason = (typeof STAGE_REASONS)[number];
export type StageStatus = 'pending' | 'running' | 'passed' | 'blocked';
export type RunStatus = 'running' | 'passed' | 'halted';

export interface RunStage {
  status: StageStatus;
  /** Present when the stage is `blocked`. */
  reason?: StageReason;
}

/** One row of the run history: a run of the root, newest first. */
export interface RunSummary {
  run_id: string;
  started_at: string;
  status: RunStatus;
  /** At most the session's goal limit, in code points. */
  goal: string;
  goal_truncated: boolean;
}

export interface Run {
  run_id: string;
  workflow: string;
  harness: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  order: string[];
  stages: Record<string, RunStage>;
  /** The state of each check of `intent.accept`, by id, with the ids sorted. */
  checks: Record<string, CheckState>;
}

interface EventBase {
  seq: number;
  run_id: string;
  at: string;
}

/** A stage of the run moved to a new status. */
export interface StageStateEvent extends EventBase {
  type: 'stage_state';
  stage: string;
  /** A stage never moves back to `pending`, so no event has it. */
  status: Exclude<StageStatus, 'pending'>;
  /** Present when the status is `blocked`. */
  reason?: StageReason;
}

/**
 * One line of a stage's standard output. It is sent while the run is active
 * and for 60 seconds after `run_finished`, and never stored.
 */
export interface ConsoleEvent extends EventBase {
  type: 'console';
  stage: string;
  /** The place of the line in the stage's output, from 1. */
  n: number;
  text: string;
}

export interface RunFinishedEvent extends EventBase {
  type: 'run_finished';
  status: Exclude<RunStatus, 'running'>;
  exit_code: number;
}

export type RunEvent = StageStateEvent | ConsoleEvent | RunFinishedEvent;
