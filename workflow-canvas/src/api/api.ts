// SPDX-License-Identifier: Apache-2.0
import type { RunView, Session, WorkflowDocument } from './types';

/**
 * The calls of the workflow API that the page makes. The page depends on
 * this port; `createHttpApi` is the adapter that talks to the server.
 */
export interface WorkflowApi {
  /** Trades the launch code for a session. */
  createSession(code: string): Promise<Session>;
  /** Loads the root workflow of the session. */
  getWorkflow(token: string): Promise<WorkflowDocument>;
  /** Starts a run of the root workflow with the goal; resolves to its id. */
  startRun(token: string, goal: string): Promise<string>;
  /** Reads the state of a run, live or finished. */
  getRun(token: string, runId: string): Promise<RunView>;
}

/** A call that failed, with a message that is fit to show to a person. */
export class ApiError extends Error {
  /** The HTTP status, or 0 when the server did not answer. */
  readonly status: number;
  /** The `code` of the error body, when there was one. */
  readonly code?: string;
  /** The `run_id` of the error body, when there was one. */
  readonly runId?: string;

  constructor(message: string, status: number, code?: string, runId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.runId = runId;
  }
}
