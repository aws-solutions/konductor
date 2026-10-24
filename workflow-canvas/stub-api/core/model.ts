// SPDX-License-Identifier: Apache-2.0

/** The wire shapes of api/openapi.yaml that the core produces. */
export type DiagnosticCode =
  | 'YAML_SYNTAX'
  | 'YAML_UNSUPPORTED'
  | 'NOT_A_MAPPING'
  | 'UNKNOWN_KEY'
  | 'DUPLICATE_KEY'
  | 'MISSING_KEY'
  | 'WRONG_TYPE'
  | 'INVALID_NAME'
  | 'RESERVED_NAME'
  | 'DUPLICATE_STAGE'
  | 'NAME_MISMATCH'
  | 'INVALID_VALUE';

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

export interface Stage {
  name: string;
  agent: string;
}

export interface WorkflowView {
  name: string;
  intent: { outcome: string };
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
