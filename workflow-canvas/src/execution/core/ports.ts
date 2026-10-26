// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

/**
 * The calls of the API that a run needs, already tied to a session. The
 * page depends on this port; `workflow/load-workflow.ts` builds the adapter.
 */
export interface RunPort {
  /**
   * Starts a run with the goal and resolves to its id. When a run is already
   * active it rejects with `RunAlreadyActive`, so the caller can follow that run.
   */
  start(goal: string): Promise<string>;
  /**
   * Reads the state of the run with the id. It rejects with `RunReadRefused`
   * when the server will not give the run, so the caller does not try again.
   */
  get(runId: string): Promise<RunView>;
}

/** A run was asked for while another is active; `runId` is the active one. */
export class RunAlreadyActive extends Error {
  readonly runId: string;

  constructor(message: string, runId: string) {
    super(message);
    this.name = 'RunAlreadyActive';
    this.runId = runId;
  }
}

/** A read that failed in a way that reading again cannot fix. */
export class RunReadRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunReadRefused';
  }
}

/**
 * The only source of time for the core, so a test can move it by hand. The
 * timer adapter is `execution/timer-scheduler.ts`.
 */
export interface Scheduler {
  /** Resolves after `ms` milliseconds, or at once when the signal aborts. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
