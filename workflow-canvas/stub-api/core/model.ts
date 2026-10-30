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

/** A check of the intent. This build reads `file` checks only. */
export interface Check {
  id: string;
  file: string;
}

export interface Param {
  description?: string;
  default?: string;
}

export interface Intent {
  outcome: string;
  accept?: Check[];
}

export interface Stage {
  name: string;
  agent: string;
  prompt?: string;
  prompt_file?: string;
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

export interface WorkflowDocument {
  name: string;
  text: string | null;
  hash: string | null;
  read_only: boolean;
  view: WorkflowView | null;
  diagnostics: Diagnostic[];
}

export interface SaveResult {
  hash: string;
  view: WorkflowView;
  diagnostics: Diagnostic[];
}

export type StageStatus = 'pending' | 'running' | 'passed' | 'blocked';
export type RunStatus = 'running' | 'passed' | 'halted';

export interface Run {
  run_id: string;
  workflow: string;
  harness: string;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  order: string[];
  stages: Record<string, { status: StageStatus }>;
}
