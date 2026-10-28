// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

/**
 * The calls of the API that a run needs, already tied to a session. The
 * page depends on this port; `workflow/load-workflow.ts` builds the adapter.
 * A call rejects when its signal aborts, and gives up on its own when the
 * server does not answer, so the caller never waits for ever.
 */
export interface RunPort {
  /**
   * Starts a run with the goal and resolves to its id. When a run is already
   * active it rejects with `RunAlreadyActive`, so the caller can follow that run.
   * When it cannot tell whether the run started it rejects with `RunStartUnsure`.
   */
  start(goal: string, signal: AbortSignal): Promise<string>;
  /**
   * Reads the state of the run with the id. It rejects with `RunReadRefused`
   * when the server will not give the run, so the caller does not try again.
   */
  get(runId: string, signal: AbortSignal): Promise<RunView>;
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

/**
 * A start whose outcome is not known: the server did not answer, or accepted
 * the run in a reply that could not be read. The run may be going.
 */
export class RunStartUnsure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunStartUnsure';
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
 * timer adapter lives in the layer that draws the tab.
 */
export interface Scheduler {
  /** Resolves after `ms` milliseconds, or at once when the signal aborts. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
