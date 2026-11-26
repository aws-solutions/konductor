// SPDX-License-Identifier: Apache-2.0
/**
 * The core of a run: its state, the words drawn from it, and the ports the
 * calls of the API and the time come in through. It does no IO.
 * @module
 */
export type { ExecutionState, TrustRefusal } from './execution-state';
export { GOAL_MAX_LENGTH, goalProblem } from './goal';
export {
  RunAlreadyActive,
  RunNeedsTrust,
  RunStartUnsure,
  type RunMemory,
  type RunPort,
  type Scheduler,
} from './ports';
export { reasonSentence } from './stage-reason';
export { trustCommandOf } from './trust';
