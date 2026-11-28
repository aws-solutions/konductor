// SPDX-License-Identifier: Apache-2.0

/** One stage to draw. */
export interface StageSpec {
  /**
   * What names the stage's node. It defaults to the name of the stage, which
   * is unique in a saved workflow. A workflow being edited may give two stages
   * one name for a moment, or change a name, so it gives an id that does not.
   */
  id?: string;
  name: string;
  agent: string;
  outcome?: string;
  prompt?: string;
  prompt_file?: string;
  /** A check finding placed on this stage card. */
  problem?: string;
}

/** The part of a workflow that can be drawn. The API view satisfies it. */
export interface WorkflowSpec {
  name: string;
  intent: { outcome: string };
  /** The number of declared workflow parameters. */
  paramCount?: number;
  stages: readonly StageSpec[];
}

/** What the stop mark of a leaf stage shows once its part of the run is over. */
export type StopMarkState = 'passed' | 'blocked' | 'not-reached';

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
  data: { outcome: string; paramCount: number };
};

/** One unit of work, done by one agent on one harness. */
export type StageGraphNode = Placed & {
  type: 'stage';
  data: {
    name: string;
    agent: string;
    harness: string;
    /** The result this stage should produce, or its first prompt line. */
    description?: string;
    /** The full description, before the card cuts it to one line. */
    descriptionTitle?: string;
    /** A check finding placed on the card. */
    problem?: string;
    /** No stage follows this one, so the run ends here, at a stop mark. */
    endsRun?: true;
    /** What that stop mark shows; left out while the run may still reach it. */
    stopState?: StopMarkState;
  };
};

export type GraphNode = IntentGraphNode | StageGraphNode;

/** A node that has its content and size but is not placed yet. */
export type Unplaced<N extends GraphNode> = Omit<N, 'position'>;

/** Any kind of node, not placed yet. */
export type UnplacedNode = Unplaced<IntentGraphNode> | Unplaced<StageGraphNode>;

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

/** What to draw: the intent, the stages under it, and the order edges. */
export interface CanvasGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** The id of the port where a node's run order leaves it. */
export const SEQUENCE_OUT = 'sequence-out';
/** The id of the port where the previous node's run order arrives. */
export const SEQUENCE_IN = 'sequence-in';
