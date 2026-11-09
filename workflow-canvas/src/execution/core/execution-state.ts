// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

/**
 * A start refused because the workflow is not trusted: the `fix` of the
 * server, and the goal of that start, so the same run can be asked for again.
 */
export interface TrustNeeded {
  fix: string;
  goal: string;
}

/**
 * A trust refusal as the state holds it. `refusal` counts the refusals in a
 * row, from 1, so each new refusal has a number of its own while a state
 * rebuilt with the same content keeps it. The dialog keys its closed state on
 * it.
 */
export interface TrustRefusal extends TrustNeeded {
  refusal: number;
}

/** Where the Execution tab is in the life of a run. */
export type ExecutionState =
  | { phase: 'idle' }
  | {
      phase: 'starting';
      /** The trust refusals in a row before this start, when there were any. */
      trustRefusals?: number;
    }
  | {
      phase: 'following';
      runId: string;
      run: RunView | undefined;
      /** Set when the tab joined a run that was already active. */
      joined?: true;
    }
  | {
      phase: 'finished';
      run: RunView;
      /** Set when the tab joined a run that was already active. */
      joined?: true;
    }
  | {
      phase: 'error';
      message: string;
      started: boolean;
      /** Set when the start got no clear answer, so the run may be going. */
      maybeStarted?: true;
      /** The run that was being followed, when the failure came after it began. */
      runId?: string;
      /** Set when the start was refused because the workflow is not trusted. */
      trust?: TrustRefusal;
    };

/** Something that happened to the run, in the order it can. */
export type ExecutionEvent =
  | { type: 'start' }
  | { type: 'started'; runId: string; joined?: boolean }
  | { type: 'snapshot'; run: RunView }
  | {
      type: 'failed';
      message: string;
      /** The run the failure belongs to, once the loop has one. */
      runId?: string;
      /** The start got no clear answer, so the run may have started. */
      maybeStarted?: true;
      /** The start was refused because the workflow is not trusted. */
      trust?: TrustNeeded;
    };

/** The state before any run has been started. */
export const IDLE: ExecutionState = { phase: 'idle' };

/** Whether a run has been asked for and has not ended. */
export function isInFlight(state: ExecutionState): boolean {
  return state.phase === 'starting' || state.phase === 'following';
}

/** Whether the run in flight is one that was already going when joined. */
export function isJoinedRun(state: ExecutionState): boolean {
  return state.phase === 'following' && state.joined === true;
}

/** The run that the tab shows, if it has heard of one. */
export function runOf(state: ExecutionState): RunView | undefined {
  return state.phase === 'following' || state.phase === 'finished'
    ? state.run
    : undefined;
}

// A start after a trust refusal carries the count on, so the next refusal
// gets the next number.
function startOf(state: ExecutionState): ExecutionState {
  if (isInFlight(state)) return state;
  return state.phase === 'error' && state.trust
    ? { phase: 'starting', trustRefusals: state.trust.refusal }
    : { phase: 'starting' };
}

function startedOf(
  state: ExecutionState,
  runId: string,
  joined: boolean | undefined,
): ExecutionState {
  if (state.phase !== 'starting') return state;
  return joined
    ? { phase: 'following', runId, run: undefined, joined: true }
    : { phase: 'following', runId, run: undefined };
}

function snapshotOf(state: ExecutionState, run: RunView): ExecutionState {
  if (state.phase !== 'following' || state.runId !== run.runId) return state;
  if (run.status !== 'running') {
    return state.joined
      ? { phase: 'finished', run, joined: true }
      : { phase: 'finished', run };
  }
  return state.joined
    ? { phase: 'following', runId: run.runId, run, joined: true }
    : { phase: 'following', runId: run.runId, run };
}

// A failure counts only for the run it belongs to: one that names no run is
// for a start that has not got an id yet, and one that names a run is for the
// run being followed. A loop that lost to another cannot end the winner's run.
// A failure with no run id cannot be told from the start of another loop, so
// the caller runs one loop at a time.
function failedOf(
  state: ExecutionState,
  {
    message,
    runId,
    maybeStarted,
    trust,
  }: Extract<ExecutionEvent, { type: 'failed' }>,
): ExecutionState {
  if (state.phase === 'starting' && runId === undefined) {
    if (trust) {
      const refusal = (state.trustRefusals ?? 0) + 1;
      return {
        phase: 'error',
        message,
        started: false,
        trust: { ...trust, refusal },
      };
    }
    return maybeStarted
      ? { phase: 'error', message, started: false, maybeStarted: true }
      : { phase: 'error', message, started: false };
  }
  if (state.phase === 'following' && runId === state.runId) {
    return { phase: 'error', message, started: true, runId: state.runId };
  }
  return state;
}

/**
 * The next state after an event. An event that does not fit the state, such as
 * a start while a run is in flight or a reading or failure of another run,
 * changes nothing.
 */
export function reduce(
  state: ExecutionState,
  event: ExecutionEvent,
): ExecutionState {
  switch (event.type) {
    case 'start':
      return startOf(state);
    case 'started':
      return startedOf(state, event.runId, event.joined);
    case 'snapshot':
      return snapshotOf(state, event.run);
    case 'failed':
      return failedOf(state, event);
  }
}
