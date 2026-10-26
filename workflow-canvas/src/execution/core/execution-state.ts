// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

/** Where the Execution tab is in the life of a run. */
export type ExecutionState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'following'; runId: string; run: RunView | undefined }
  | { phase: 'finished'; run: RunView }
  | { phase: 'error'; message: string; started: boolean };

/** Something that happened to the run, in the order it can. */
export type ExecutionEvent =
  | { type: 'start' }
  | { type: 'started'; runId: string }
  | { type: 'snapshot'; run: RunView }
  | { type: 'failed'; message: string };

/** The state before any run has been started. */
export const IDLE: ExecutionState = { phase: 'idle' };

/** Whether a run has been asked for and has not ended. */
export function isInFlight(state: ExecutionState): boolean {
  return state.phase === 'starting' || state.phase === 'following';
}

/** The run that the tab shows, if it has heard of one. */
export function runOf(state: ExecutionState): RunView | undefined {
  return state.phase === 'following' || state.phase === 'finished'
    ? state.run
    : undefined;
}

function startOf(state: ExecutionState): ExecutionState {
  return isInFlight(state) ? state : { phase: 'starting' };
}

function startedOf(state: ExecutionState, runId: string): ExecutionState {
  return state.phase === 'starting'
    ? { phase: 'following', runId, run: undefined }
    : state;
}

function snapshotOf(state: ExecutionState, run: RunView): ExecutionState {
  if (state.phase !== 'following' || state.runId !== run.runId) return state;
  return run.status === 'running'
    ? { phase: 'following', runId: run.runId, run }
    : { phase: 'finished', run };
}

function failedOf(state: ExecutionState, message: string): ExecutionState {
  return isInFlight(state)
    ? { phase: 'error', message, started: state.phase === 'following' }
    : state;
}

/**
 * The next state after an event. An event that does not fit the state, such as
 * a start while a run is in flight or a reply for an earlier run, changes
 * nothing.
 */
export function reduce(
  state: ExecutionState,
  event: ExecutionEvent,
): ExecutionState {
  switch (event.type) {
    case 'start':
      return startOf(state);
    case 'started':
      return startedOf(state, event.runId);
    case 'snapshot':
      return snapshotOf(state, event.run);
    case 'failed':
      return failedOf(state, event.message);
  }
}
