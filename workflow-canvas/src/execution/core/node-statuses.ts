// SPDX-License-Identifier: Apache-2.0
import type { RunStageView, RunView } from '../../api/types';
import { END_ID, INTENT_ID, stageNodeId, type NodeStatus } from '../../graph';

const QUEUED: NodeStatus = { state: 'queued', label: 'Queued' };
const RUNNING: NodeStatus = { state: 'running', label: 'Running' };
const DONE: NodeStatus = { state: 'done', label: 'Done' };
const FAILED: NodeStatus = { state: 'failed', label: 'Failed' };
const NOT_RUN: NodeStatus = { state: 'queued', label: 'Not run' };

function stageStatus(stage: RunStageView, run: RunView): NodeStatus {
  switch (stage.status) {
    case 'pending':
      // After a halt the stages behind the failed one will not start.
      return run.status === 'halted' ? NOT_RUN : QUEUED;
    case 'running':
      return RUNNING;
    case 'passed':
      return DONE;
    case 'blocked':
      return FAILED;
  }
}

// The end shows the result of the run once there is one.
function endStatus(run: RunView): NodeStatus {
  switch (run.status) {
    case 'running':
      return QUEUED;
    case 'passed':
      return { state: 'done', label: 'Passed' };
    case 'halted':
      return { state: 'failed', label: 'Halted' };
  }
}

/**
 * The status of each node of the graph for a run, by node id: the intent is
 * done once the run has it, each stage follows its stage of the run, and the
 * end shows the result. Without a run no node has a status.
 */
export function nodeStatuses(
  run: RunView | undefined,
): ReadonlyMap<string, NodeStatus> {
  if (!run) return new Map();
  return new Map<string, NodeStatus>([
    [INTENT_ID, DONE],
    ...run.stages.map((stage): [string, NodeStatus] => [
      stageNodeId(stage.name),
      stageStatus(stage, run),
    ]),
    [END_ID, endStatus(run)],
  ]);
}
