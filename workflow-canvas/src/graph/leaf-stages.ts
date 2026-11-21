// SPDX-License-Identifier: Apache-2.0
import type { CanvasGraph, StopMarkState } from './model';

export type { StopMarkState };

/**
 * The ids of the stage nodes that no other stage follows, in the order of the
 * nodes. An edge to a node that is not a stage, such as the end, does not
 * count, so the answer is the same with or without an end node.
 */
export function leafStages(graph: CanvasGraph): string[] {
  const stages = graph.nodes.filter((node) => node.type === 'stage');
  const ids = new Set(stages.map((node) => node.id));
  const followed = new Set(
    graph.edges
      .filter((edge) => edge.source !== edge.target && ids.has(edge.target))
      .map((edge) => edge.source),
  );
  return stages.filter((node) => !followed.has(node.id)).map((node) => node.id);
}

/** The status of a stage in a run, as the API gives it. */
export type LeafStageStatus = 'pending' | 'running' | 'passed' | 'blocked';

/** The status of a run, as the API gives it. */
export type LeafRunStatus = 'running' | 'passed' | 'halted';

/**
 * The state of the stop mark of a leaf stage: `passed` or `blocked` once the
 * stage is, `not-reached` when the run halted before it, and `undefined`
 * while the run may still reach it.
 */
export function stopMarkState(
  stage: LeafStageStatus,
  run: LeafRunStatus,
): StopMarkState | undefined {
  if (stage === 'passed') return 'passed';
  if (stage === 'blocked') return 'blocked';
  return run === 'halted' ? 'not-reached' : undefined;
}
