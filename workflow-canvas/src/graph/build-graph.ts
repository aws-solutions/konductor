// SPDX-License-Identifier: Apache-2.0
import { NODE_HEIGHT, stackDown } from './layout';
import {
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type CanvasGraph,
  type GraphEdge,
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
    type: 'stage',
    height: NODE_HEIGHT.stage,
    data: { name: stage.name, agent: stage.agent, harness },
  };
}

function endNode(): Unplaced<EndGraphNode> {
  return { id: END_ID, type: 'end', height: NODE_HEIGHT.end, data: {} };
}

/** One edge from each node to the next. */
function chain(ids: readonly string[]): GraphEdge[] {
  return ids.slice(1).map((target, index) => {
    const source = ids[index] ?? '';
    return {
      id: `${source}->${target}`,
      source,
      target,
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
  return { nodes, edges: chain(nodes.map((node) => node.id)) };
}
