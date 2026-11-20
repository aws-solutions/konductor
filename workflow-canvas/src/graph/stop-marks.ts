// SPDX-License-Identifier: Apache-2.0
import { leafStages } from './leaf-stages';
import type {
  CanvasGraph,
  GraphNode,
  StageGraphNode,
  StopMarkState,
} from './model';

function marked(
  node: StageGraphNode,
  state: StopMarkState | undefined,
): StageGraphNode {
  return {
    ...node,
    data: {
      ...node.data,
      endsRun: true,
      ...(state === undefined ? {} : { stopState: state }),
    },
  };
}

function withoutEnd(nodes: readonly GraphNode[]): GraphNode[] {
  return nodes.filter((node) => node.type !== 'end');
}

/**
 * The graph with each leaf stage ending in a stop mark instead of one shared
 * end node: the end node and the edges that touch it are gone, and every
 * stage that no other stage follows carries `endsRun`. A leaf keeps the
 * state in `states`, under its node id, which says what its mark shows once
 * that stage's part of the run is over; without an entry the mark is open.
 * The nodes that stay keep their places, and a graph with no end node is
 * marked all the same.
 */
export function withStopMarks(
  graph: CanvasGraph,
  states: ReadonlyMap<string, StopMarkState> = new Map(),
): CanvasGraph {
  const leaves = new Set(leafStages(graph));
  const nodes = withoutEnd(graph.nodes);
  const kept = new Set(nodes.map((node) => node.id));
  return {
    nodes: nodes.map((node) =>
      node.type === 'stage' && leaves.has(node.id)
        ? marked(node, states.get(node.id))
        : node,
    ),
    edges: graph.edges.filter(
      (edge) => kept.has(edge.source) && kept.has(edge.target),
    ),
  };
}
