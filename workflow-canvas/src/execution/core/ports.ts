// SPDX-License-Identifier: Apache-2.0

/**
 * The call of the API that a run needs, already tied to a session. The
 * page depends on this port; `workflow/load-workflow.ts` builds the adapter.
 * The call rejects when its signal aborts, and gives up on its own when the
 * server does not answer, so the caller never waits for ever. The events of
 * a run that was started come in through `ReadEvents` in `run-client/`.
 */
export interface RunPort {
  /**
   * Starts a run with the goal and resolves to its id. When a run is already
   * active it rejects with `RunAlreadyActive`, so the caller can follow that run.
   * When it cannot tell whether the run started it rejects with `RunStartUnsure`,
   * and when the workflow must be trusted first, with `RunNeedsTrust`.
   */
  start(goal: string, signal: AbortSignal): Promise<string>;
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

/**
 * The workflow is not trusted, so the run did not start. `fix` is the
 * sentence that names the command that trusts it, which the person runs in a
 * terminal: the page never grants trust.
 */
export class RunNeedsTrust extends Error {
  readonly fix: string;

  constructor(message: string, fix: string) {
    super(message);
    this.name = 'RunNeedsTrust';
    this.fix = fix;
  }
}

/**
 * The only source of time for the core, so a test can move it by hand. The
 * timer adapter lives in the layer that draws the views.
 */
export interface Scheduler {
  /** Resolves after `ms` milliseconds, or at once when the signal aborts. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

/**
 * What survives a reload of the page: the id of the latest run, so that the
 * page can find a run that is still going. The adapter is
 * `execution/run-memory.ts`.
 */
export interface RunMemory {
  /** The id of the latest run that was remembered, if any. */
  recall(): string | undefined;
  remember(runId: string): void;
  /** Drops the run that was remembered, once it has ended or is gone. */
  forget(): void;
}
