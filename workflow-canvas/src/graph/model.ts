// SPDX-License-Identifier: Apache-2.0

/** The part of a workflow that can be drawn. The API view satisfies it. */
export interface WorkflowSpec {
  name: string;
  intent: { outcome: string };
  stages: readonly { name: string; agent: string }[];
}

interface Placed {
  id: string;
  /** What a screen reader says for the node. */
  ariaLabel: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

/** The start of the workflow: what it is meant to achieve. */
export type IntentGraphNode = Placed & {
  type: 'intent';
  data: { outcome: string };
};

/** One unit of work, done by one agent on one harness. */
export type StageGraphNode = Placed & {
  type: 'stage';
  data: { name: string; agent: string; harness: string };
};

/** The finish of the workflow. */
export type EndGraphNode = Placed & {
  type: 'end';
  data: Record<string, never>;
};

export type GraphNode = IntentGraphNode | StageGraphNode | EndGraphNode;

/** A node that has its content and height but is not placed yet. */
export type Unplaced<N extends GraphNode> = Omit<N, 'position' | 'width'>;

/** Any kind of node, not placed yet. */
export type UnplacedNode =
  Unplaced<IntentGraphNode> | Unplaced<StageGraphNode> | Unplaced<EndGraphNode>;

/** Run order from the sequence-out port of one node to the next one's in. */
export interface GraphEdge {
  id: string;
  /** What a screen reader says for the edge. */
  ariaLabel: string;
  source: string;
  target: string;
  sourceHandle: typeof SEQUENCE_OUT;
  targetHandle: typeof SEQUENCE_IN;
}

/** What to draw: nodes from the intent down to the end, and the order edges. */
export interface CanvasGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** The id of the port where a node's run order leaves it. */
export const SEQUENCE_OUT = 'sequence-out';
/** The id of the port where the previous node's run order arrives. */
export const SEQUENCE_IN = 'sequence-in';
