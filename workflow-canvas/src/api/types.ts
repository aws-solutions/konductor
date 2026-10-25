// SPDX-License-Identifier: Apache-2.0
// The parts of api/openapi.yaml that the page reads.

/** What `POST /api/session` returns. */
export interface Session {
  token: string;
  root: string;
  harness: string;
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

/** A problem the server found in the workflow text. */
export interface DiagnosticView {
  message: string;
  line: number;
}

/** What `GET /api/workflow` returns. */
export interface WorkflowDocument {
  name: string;
  /** `null` when the file does not exist yet. */
  text: string | null;
  /** `null` when there is no text or the text has errors. */
  view: WorkflowView | null;
  diagnostics: DiagnosticView[];
}
