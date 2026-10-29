// SPDX-License-Identifier: Apache-2.0
import { NODE_HEIGHT, stackDown } from './layout';
import {
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type CanvasGraph,
  type GraphEdge,
  type GraphNode,
  type EndGraphNode,
  type IntentGraphNode,
  type StageGraphNode,
  type Unplaced,
  type UnplacedNode,
  type WorkflowSpec,
} from './model';

const INTENT_ID = 'intent';
const END_ID = 'end';

/** The id of the node that draws the stage called `name`. */
export function stageNodeId(name: string): string {
  return `stage-${name}`;
}

function intentNode(spec: WorkflowSpec): Unplaced<IntentGraphNode> {
  return {
    id: INTENT_ID,
    ariaLabel: `Intent: ${spec.intent.outcome}`,
    type: 'intent',
    height: NODE_HEIGHT.intent,
    data: { outcome: spec.intent.outcome },
  };
}

function stageNode(
  stage: WorkflowSpec['stages'][number],
  harness: string,
): Unplaced<StageGraphNode> {
  return {
    id: stageNodeId(stage.name),
    ariaLabel: `Stage ${stage.name}, agent ${stage.agent}, harness ${harness}`,
    type: 'stage',
    height: NODE_HEIGHT.stage,
    data: { name: stage.name, agent: stage.agent, harness },
  };
}

function endNode(): Unplaced<EndGraphNode> {
  return {
    id: END_ID,
    ariaLabel: 'End',
    type: 'end',
    height: NODE_HEIGHT.end,
    data: {},
  };
}

/** A short name for a node, to say which nodes an edge joins. */
function titleOf(node: GraphNode): string {
  switch (node.type) {
    case 'intent':
      return 'intent';
    case 'stage':
      return `stage ${node.data.name}`;
    case 'end':
      return 'end';
  }
}

// One edge from each node to the next.
function chain(nodes: readonly GraphNode[]): GraphEdge[] {
  return nodes.slice(1).map((target, index) => {
    const source = nodes[index] ?? target;
    return {
      id: `${source.id}->${target.id}`,
      ariaLabel: `Run order from ${titleOf(source)} to ${titleOf(target)}`,
      source: source.id,
      target: target.id,
      sourceHandle: SEQUENCE_OUT,
      targetHandle: SEQUENCE_IN,
    };
  });
}

/**
 * Turns a workflow into what the canvas draws: the intent, the stages in list
 * order, and the end, in one column, joined by run-order edges.
 */
export function buildGraph(spec: WorkflowSpec, harness: string): CanvasGraph {
  const nodes = stackDown<UnplacedNode>([
    intentNode(spec),
    ...spec.stages.map((stage) => stageNode(stage, harness)),
    endNode(),
  ]);
  return { nodes, edges: chain(nodes) };
}
