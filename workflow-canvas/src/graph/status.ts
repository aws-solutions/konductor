// SPDX-License-Identifier: Apache-2.0
import type { CanvasGraph, GraphNode, NodeStatus } from './model';

function withStatus<N extends GraphNode>(node: N, status?: NodeStatus): N {
  if (!status) return node;
  return {
    ...node,
    ariaLabel: `${node.ariaLabel}, ${status.label.toLowerCase()}`,
    data: { ...node.data, status },
  };
}

/**
 * Gives each node the status that `statuses` holds for its id, in its data
 * and in its name for a screen reader. Nodes without an entry are unchanged.
 */
export function withStatuses(
  graph: CanvasGraph,
  statuses: ReadonlyMap<string, NodeStatus>,
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => withStatus(node, statuses.get(node.id))),
  };
}
