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
  type StageSpec,
  type Unplaced,
  type UnplacedNode,
  type WorkflowSpec,
} from './model';

/** The id of the node that draws the intent. */
export const INTENT_ID = 'intent';
/** The id of the node that draws the end. */
export const END_ID = 'end';

/**
 * The id of the node that draws a stage, from its `id`, or from its name if
 * it has no id.
 */
export function stageNodeId(key: string): string {
  return `stage-${key}`;
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

// Two stages with one name read alike, so each says its place in the list.
function stageLabel(
  stage: StageSpec,
  harness: string,
  place: { at: number; of: number } | undefined,
): string {
  const where = place ? ` (${place.at} of ${place.of})` : '';
  return `Stage ${stage.name}${where}, agent ${stage.agent}, harness ${harness}`;
}

// The place of the stage, only when another stage has its name.
function placeOf(stages: readonly StageSpec[], index: number) {
  const name = stages[index]?.name;
  const shared = stages.filter((stage) => stage.name === name).length > 1;
  return shared ? { at: index + 1, of: stages.length } : undefined;
}

function stageNode(
  stage: StageSpec,
  harness: string,
  place: { at: number; of: number } | undefined,
): Unplaced<StageGraphNode> {
  return {
    id: stageNodeId(stage.id ?? stage.name),
    ariaLabel: stageLabel(stage, harness, place),
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
    ...spec.stages.map((stage, index) =>
      stageNode(stage, harness, placeOf(spec.stages, index)),
    ),
    endNode(),
  ]);
  return { nodes, edges: chain(nodes) };
}
