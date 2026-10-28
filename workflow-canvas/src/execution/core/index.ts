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
  reduce,
  runOf,
  type ExecutionEvent,
  type ExecutionState,
} from './execution-state';
export {
  MAX_READ_FAILURES,
  POLL_INTERVAL_MS,
  startAndFollow,
  type FollowRequest,
} from './follow-run';
export { GOAL_MAX_LENGTH, goalProblem } from './goal';
export { nodeStatuses } from './node-statuses';
export {
  RunAlreadyActive,
  RunReadRefused,
  RunStartUnsure,
  type RunPort,
  type Scheduler,
} from './ports';
export { statusKind, statusText, type StatusKind } from './status-text';
