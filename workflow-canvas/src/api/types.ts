// SPDX-License-Identifier: Apache-2.0
// The parts of api/openapi.yaml that the page reads.

/** What `POST /api/session` returns. */
export interface Session {
  token: string;
  root: string;
  harness: string;
  /** The major version of the API. */
  apiVersion: number;
}

/** One unit of work in a workflow view. */
export interface StageView {
  name: string;
  agent: string;
}

/** The parsed workflow, ready to draw. */
export interface WorkflowView {
  name: string;
  intent: { outcome: string };
  stages: StageView[];
}

/** How serious a finding of the check is. */
export type Severity = 'error' | 'warning' | 'info';

/** A problem the server found in the workflow text. */
export interface DiagnosticView {
  message: string;
  /** The line in the text, counted from 1; `undefined` when the reply has none. */
  line: number | undefined;
  /**
   * The key path of the finding, such as `stages.write.agent` or
   * `stages[1].name`; the empty string for the whole text.
   */
  path: string;
  /** A severity this page does not know counts as `error`. */
  severity: Severity;
}

/** What `GET /api/workflow` returns. */
export interface WorkflowDocument {
  name: string;
  /** `null` when the file does not exist yet. */
  text: string | null;
  /** The hash to send back as `base_hash`; `null` when there is no file. */
  hash: string | null;
  /** True when the file cannot be saved. */
  readOnly: boolean;
  /** `null` when there is no text or the text has errors. */
  view: WorkflowView | null;
  diagnostics: DiagnosticView[];
}

/** What `PUT /api/workflow` returns: the file as it was written. */
export interface SaveResult {
  hash: string;
  view: WorkflowView;
  diagnostics: DiagnosticView[];
}

/** What `POST /api/validate` returns. */
export interface CheckResult {
  /** `null` when the text has errors. */
  view: WorkflowView | null;
  diagnostics: DiagnosticView[];
}

/** How far a stage of a run has got. `blocked` failed and stopped the run. */
export type StageRunStatus = 'pending' | 'running' | 'passed' | 'blocked';

/** How a run as a whole is going. `halted` means a stage failed. */
export type RunStatus = 'running' | 'passed' | 'halted';

/** One stage of a run, in run order. */
export interface RunStageView {
  name: string;
  status: StageRunStatus;
}

/** What `GET /api/runs/{id}` returns: the state of a run, live or finished. */
export interface RunView {
  runId: string;
  status: RunStatus;
  /** `null` while the run is `running`. */
  exitCode: number | null;
  stages: RunStageView[];
}
