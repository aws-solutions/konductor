// SPDX-License-Identifier: Apache-2.0
/**
 * The core of the Execution tab: the state of a run, the loop that follows
 * it, and the words and node states drawn from it. It does no IO; the calls
 * of the API and the time come in through its ports.
 * @module
 */
export {
  IDLE,
  isInFlight,
  isJoinedRun,
  reduce,
  runOf,
  type ExecutionEvent,
  type ExecutionState,
  type TrustNeeded,
  type TrustRefusal,
} from './execution-state';
export {
  MAX_READ_FAILURES,
  POLL_INTERVAL_MS,
  resumeRun,
  startAndFollow,
  type FollowRequest,
} from './follow-run';
export { GOAL_MAX_LENGTH, goalProblem } from './goal';
export { nodeStatuses } from './node-statuses';
export {
  NO_RUN_MEMORY,
  RunAlreadyActive,
  RunNeedsTrust,
  RunReadRefused,
  RunStartUnsure,
  type RunMemory,
  type RunPort,
  type Scheduler,
} from './ports';
export { stageDrift, type StageDrift } from './stage-drift';
export { blockedStageOf, reasonSentence } from './stage-reason';
export { trustCommandOf } from './trust';
export { statusKind, statusText, type StatusKind } from './status-text';
