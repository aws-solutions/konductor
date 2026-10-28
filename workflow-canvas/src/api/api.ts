// SPDX-License-Identifier: Apache-2.0
import type {
  CheckResult,
  DiagnosticView,
  RunView,
  SaveResult,
  Session,
  WorkflowDocument,
} from './types';

/**
 * The calls of the workflow API that the page makes. The page depends on
 * this port; `createHttpApi` is the adapter that talks to the server.
 */
export interface WorkflowApi {
  /** Trades the launch code for a session. */
  createSession(code: string): Promise<Session>;
  /** Loads the root workflow of the session. */
  getWorkflow(token: string): Promise<WorkflowDocument>;
  /**
   * Writes the text of the root workflow if the file still has `baseHash`.
   * A file that changed fails with code `conflict`; a text with errors fails
   * with code `invalid_workflow` and its `diagnostics`.
   */
  saveWorkflow(
    token: string,
    text: string,
    baseHash: string | null,
  ): Promise<SaveResult>;
  /** Checks workflow text without writing it. */
  checkWorkflow(token: string, text: string): Promise<CheckResult>;
  /**
   * Starts a run of the root workflow with the goal; resolves to its id.
   * Aborting the signal ends the call.
   */
  startRun(token: string, goal: string, signal?: AbortSignal): Promise<string>;
  /** Reads the state of a run, live or finished. */
  getRun(token: string, runId: string, signal?: AbortSignal): Promise<RunView>;
}

/** A call that failed, with a message that is fit to show to a person. */
export class ApiError extends Error {
  /** The HTTP status, or 0 when the server did not answer. */
  readonly status: number;
  /** The `code` of the error body, when there was one. */
  readonly code?: string;
  /** The `run_id` of the error body, when there was one. */
  readonly runId?: string;
  /** The `diagnostics` of the error body; empty when there were none. */
  readonly diagnostics: readonly DiagnosticView[];
  /** The `current_hash` of a 409 body: the hash of the file as it is now. */
  readonly currentHash?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    runId?: string,
    diagnostics: readonly DiagnosticView[] = [],
    currentHash?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.runId = runId;
    this.diagnostics = diagnostics;
    this.currentHash = currentHash;
  }
}

/**
 * Whether a failed call can succeed on the next try: no answer (status 0) or a
 * server error (5xx). Any 4xx will not change.
 */
export function canRetryStatus(status: number): boolean {
  return status === 0 || status >= 500;
}
