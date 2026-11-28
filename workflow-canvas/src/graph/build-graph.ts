// SPDX-License-Identifier: Apache-2.0
import { NODE_HEIGHT, NODE_WIDTH, stackDown } from './layout';
import { withStopMarks } from './stop-marks';
import {
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type CanvasGraph,
  type GraphEdge,
  type GraphNode,
  type IntentGraphNode,
  type StageGraphNode,
  type StageSpec,
  type Unplaced,
  type UnplacedNode,
  type WorkflowSpec,
} from './model';

/** The id of the node that draws the intent. */
export const INTENT_ID = 'intent';

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
    width: NODE_WIDTH.intent,
    height: NODE_HEIGHT.intent,
    data: { outcome: spec.intent.outcome, paramCount: spec.paramCount ?? 0 },
  };
}

// Two stages with one name read alike, so each says its place in the list.
function stageLabel(
  stage: StageSpec,
  harness: string,
  place: { at: number; of: number } | undefined,
): string {
  const where = place ? ` (${place.at} of ${place.of})` : '';
  const problem = stage.problem ? `, problem: ${stage.problem}` : '';
  return `Stage ${stage.name}${where}, agent ${stage.agent}, harness ${harness}${problem}`;
}

// The place of the stage, only when another stage has its name.
function placeOf(stages: readonly StageSpec[], index: number) {
  const name = stages[index]?.name;
  const shared = stages.filter((stage) => stage.name === name).length > 1;
  return shared ? { at: index + 1, of: stages.length } : undefined;
}

function descriptionOf(
  stage: StageSpec,
): Pick<StageGraphNode['data'], 'description' | 'descriptionTitle'> {
  if (stage.outcome !== undefined) {
    return {
      description: stage.outcome,
      descriptionTitle: stage.outcome,
    };
  }
  if (stage.prompt_file !== undefined || stage.prompt === undefined) return {};
  const description = stage.prompt.split(/\r\n|\r|\n/, 1)[0]?.trim();
  return description ? { description, descriptionTitle: stage.prompt } : {};
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
    width: NODE_WIDTH.stage,
    height: NODE_HEIGHT.stage,
    data: {
      name: stage.name,
      agent: stage.agent,
      harness,
      ...descriptionOf(stage),
      ...(stage.problem === undefined ? {} : { problem: stage.problem }),
    },
  };
}

/** A short name for a node, to say which nodes an edge joins. */
function titleOf(node: GraphNode): string {
  return node.type === 'intent' ? 'intent' : `stage ${node.data.name}`;
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
 * Turns a workflow into what the canvas draws: the intent and the stages in
 * list order, in one column, joined by run-order edges, with a stop mark on
 * each stage that no other stage follows.
 */
export function buildGraph(spec: WorkflowSpec, harness: string): CanvasGraph {
  const nodes = stackDown<UnplacedNode>([
    intentNode(spec),
    ...spec.stages.map((stage, index) =>
      stageNode(stage, harness, placeOf(spec.stages, index)),
    ),
  ]);
  return withStopMarks({ nodes, edges: chain(nodes) });
}
