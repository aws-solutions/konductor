// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';
import type { ExecutionState } from './execution-state';

/** How the status line is drawn: at rest, at work, passed or not working. */
export type StatusKind = 'idle' | 'busy' | 'success' | 'error';

const JOINED = 'Following the run that was already in progress.';

function stagesDone(run: RunView): string {
  const done = run.stages.filter((stage) => stage.status === 'passed').length;
  return `${done} of ${run.stages.length} stages done.`;
}

function followingText(run: RunView | undefined): string {
  if (!run) return 'Waiting for the first status of the run.';
  const current = run.stages.find((stage) => stage.status === 'running');
  const lead = current
    ? `Running ${current.name}.`
    : 'Waiting for the next stage.';
  return `${lead} ${stagesDone(run)}`;
}

function finishedText(run: RunView): string {
  const exit = run.exitCode === null ? '' : ` Exit code ${run.exitCode}.`;
  const blocked = run.stages.find((stage) => stage.status === 'blocked');
  const lead =
    run.status === 'passed'
      ? 'Run passed.'
      : `Run halted${blocked ? ` at ${blocked.name}` : ''}.`;
  return `${lead} ${stagesDone(run)}${exit}`;
}

/** The sentence that says where the run is. A screen reader announces it. */
export function statusText(state: ExecutionState): string {
  switch (state.phase) {
    case 'idle':
      return 'Ready. Press Run to start.';
    case 'starting':
      return 'Starting the run.';
    case 'following':
      return state.joined
        ? `${JOINED} ${followingText(state.run)}`
        : followingText(state.run);
    case 'finished':
      return finishedText(state.run);
    case 'error':
      return 'See the error below.';
  }
}

/** What kind of status the sentence is, so it can be drawn to match. */
export function statusKind(state: ExecutionState): StatusKind {
  switch (state.phase) {
    case 'idle':
      return 'idle';
    case 'starting':
    case 'following':
      return 'busy';
    case 'finished':
      return state.run.status === 'passed' ? 'success' : 'error';
    case 'error':
      return 'error';
  }
}
