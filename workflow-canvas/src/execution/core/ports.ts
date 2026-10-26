// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

/**
 * The calls of the API that a run needs, already tied to a session. The
 * page depends on this port; `workflow/load-workflow.ts` builds the adapter.
 */
export interface RunPort {
  /** Starts a run with the goal and resolves to its id. */
  start(goal: string): Promise<string>;
  /** Reads the state of the run with the id. */
  get(runId: string): Promise<RunView>;
}

/**
 * The only source of time for the core, so a test can move it by hand. The
 * timer adapter is `execution/timer-scheduler.ts`.
 */
export interface Scheduler {
  /** Resolves after `ms` milliseconds, or at once when the signal aborts. */
  wait(ms: number, signal: AbortSignal): Promise<void>;
}
