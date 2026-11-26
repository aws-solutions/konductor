// SPDX-License-Identifier: Apache-2.0
// The parts of api/openapi.yaml that the page reads.

/** The harnesses that the contract names. `fake` is for tests only. */
export type KnownHarness = 'kiro-cli' | 'claude' | 'fake';

/**
 * The program that runs each stage's agent: one the contract names, or any
 * other that a newer server adds, as the contract lets a response enum gain
 * values. The page only shows it, as it is, and offers no way to pick one.
 */
export type Harness = KnownHarness | (string & {});

/** What `POST /api/session` returns. */
export interface Session {
  token: string;
  root: string;
  harness: Harness;
  /** The major version of the API. */
  apiVersion: number;
}

/**
 * The key of the file that names the kind of a stage: `agent`, or any other
 * that a newer server adds. The page draws a kind it does not know as a plain
 * stage.
 */
export type StageKind = 'agent' | (string & {});

/** The lines of the workflow text that a stage takes up, counted from 1, both included. */
export interface LineRange {
  line: number;
  end_line: number;
}

/** One unit of work in a workflow view. */
export interface StageView {
  name: string;
  kind: StageKind;
  agent: string;
  range: LineRange;
}

/** The keys of a stage that the editor reads and writes. */
export type StageKeys = Pick<StageView, 'name' | 'agent'>;

/** The `goal` param of a workflow file: what the file says about the goal. */
export interface GoalParamView {
  description?: string;
  default?: string;
}

/** The parsed workflow, ready to draw. */
export interface WorkflowView {
  name: string;
  intent: { outcome: string };
  /** The params of the file. The page reads the goal only. */
  params?: { goal?: GoalParamView };
  stages: StageView[];
}

/**
 * A check of `intent.accept`, which says whether the run met its intent. A
 * check has exactly one of `file` and `run`, so the key that is there names
 * the kind. The state of each one comes from a run, not from the file.
 */
export interface CheckDeclaration {
  readonly id: string;
  /** Whether the check reads a file or runs a command. */
  readonly kind: 'file' | 'run';
}

/** The checks a workflow declares, and which stage waits for each. */
export interface WorkflowChecks {
  /** The checks of `intent.accept`, in the order of the file. */
  readonly declared: readonly CheckDeclaration[];
  /** The check ids a stage's `done_when` names, by stage name. */
  readonly doneWhen: Readonly<Record<string, readonly string[]>>;
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

/** One key of a stage that a client may edit, and what it takes. */
export interface StageField {
  key: string;
  /** `name`, `text` or `path`. A type a later version adds is shown as text. */
  type: string;
  required: boolean;
  min_length?: number;
  max_length?: number;
  /** A regular expression that the whole value matches. */
  pattern?: string;
  /** Values the key may not take. */
  reserved?: string[];
  /** Keys that a stage may not have together with this one. */
  excludes?: string[];
}

/** The editable keys of a stage, for each kind of stage the page knows. */
export interface StageFields {
  agent: StageField[];
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
  stageFields: StageFields;
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
  /**
   * Why a `blocked` stage stopped the run, as a stable upper snake case code
   * such as `RESULT_MISSING`. Only a blocked stage has one, and a blocked
   * stage whose reply has a missing or empty reason has none here.
   */
  reason?: string;
}

/** What `GET /api/runs/{id}` returns: the state of a run, live or finished. */
export interface RunView {
  runId: string;
  /** The harness that runs the stages of this run. */
  harness: Harness;
  status: RunStatus;
  /** `null` while the run is `running`. */
  exitCode: number | null;
  stages: RunStageView[];
}

/** One run in `GET /api/runs`, with the key names of the contract. */
export interface RunSummary {
  run_id: string;
  /** A UTC time to the whole second, such as `2026-10-24T04:12:05Z`. */
  started_at: string;
  status: RunStatus;
  /** May be empty, for a run that took a workflow's empty default goal. */
  goal: string;
  /** True when the server cut `goal`. */
  goal_truncated: boolean;
}
