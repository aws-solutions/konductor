// SPDX-License-Identifier: Apache-2.0
import type { RunView, WorkflowView } from '../../api/types';

/** The stages that the graph and the run do not share, by name. */
export interface StageDrift {
  /** Stages of the run that the graph does not draw. */
  notInGraph: string[];
  /** Stages of the graph that the run does not have. */
  notInRun: string[];
}

/**
 * How the stages of `run` differ from those of the graph, or `undefined` when
 * they are the same stages. A workflow can be saved while a run is active, so
 * the run may be of an older or newer file than the graph, and node states,
 * which attach by stage name, then miss some nodes.
 */
export function stageDrift(
  view: WorkflowView,
  run: RunView | undefined,
): StageDrift | undefined {
  if (!run) return undefined;
  const inGraph = view.stages.map((stage) => stage.name);
  const inRun = run.stages.map((stage) => stage.name);
  const notInGraph = inRun.filter((name) => !inGraph.includes(name));
  const notInRun = inGraph.filter((name) => !inRun.includes(name));
  return notInGraph.length + notInRun.length === 0
    ? undefined
    : { notInGraph, notInRun };
}
