// SPDX-License-Identifier: Apache-2.0
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type EndGraphNode,
  type IntentGraphNode,
  type NodeStatus,
  type StageGraphNode,
} from '../graph';
import {
  CARD_RADIUS,
  FOCUS_GAP,
  FOCUS_WIDTH,
  nodeOutline,
  spreadStroke,
} from './card-shape';

type FlowNode<N extends { type: string; data: Record<string, unknown> }> = Node<
  N['data'],
  N['type']
>;

// The dot on the top edge where run order arrives. `canvas.css` shows it
// while the node is hovered, focused or selected.
function SequenceIn() {
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={SEQUENCE_IN}
      isConnectable={false}
      className="wf-port wf-port-in"
    />
  );
}

// The dot on the bottom edge where run order leaves.
function SequenceOut() {
  return (
    <Handle
      type="source"
      position={Position.Bottom}
      id={SEQUENCE_OUT}
      isConnectable={false}
      className="wf-port wf-port-out"
    />
  );
}

// The state of a node in a run, as a word in a coloured pill.
function StatusBadge({ status }: { status: NodeStatus | undefined }) {
  if (!status) return null;
  return (
    <span className="wf-badge" data-testid="status-badge">
      {status.label}
    </span>
  );
}

/**
 * The card behind the content of a node: one rounded outline, with the focus
 * ring and its gap drawn around it.
 */
function NodeShape({ height, radius }: { height: number; radius: number }) {
  const outline = nodeOutline({ width: NODE_WIDTH, height, radius });
  return (
    <svg
      className="wf-node-shape"
      width={NODE_WIDTH}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="wf-focus-ring"
        strokeWidth={spreadStroke(FOCUS_GAP + FOCUS_WIDTH)}
        d={outline}
      />
      <path
        className="wf-focus-gap"
        strokeWidth={spreadStroke(FOCUS_GAP)}
        d={outline}
      />
      <path className="wf-node-body" d={outline} />
    </svg>
  );
}

/** The start of the workflow: the outcome it is for, with a run order out. */
export function IntentNode({ data }: NodeProps<FlowNode<IntentGraphNode>>) {
  return (
    <div
      className="wf-node wf-node-intent"
      data-testid="node-intent"
      data-state={data.status?.state}
    >
      <NodeShape height={NODE_HEIGHT.intent} radius={CARD_RADIUS} />
      <div className="wf-node-title">intent</div>
      <div className="wf-node-intent-outcome" title={data.outcome}>
        {data.outcome}
      </div>
      <StatusBadge status={data.status} />
      <SequenceOut />
    </div>
  );
}

/** One stage: its name, then its agent and harness, with run order in and out. */
export function StageNode({ data }: NodeProps<FlowNode<StageGraphNode>>) {
  return (
    <div
      className="wf-node wf-node-stage"
      data-testid={`node-stage-${data.name}`}
      data-state={data.status?.state}
    >
      <NodeShape height={NODE_HEIGHT.stage} radius={CARD_RADIUS} />
      <SequenceIn />
      <div className="wf-node-title" title={data.name}>
        {data.name}
      </div>
      <div className="wf-node-sub" title={`${data.agent} · ${data.harness}`}>
        {data.agent} · {data.harness}
      </div>
      <StatusBadge status={data.status} />
      <SequenceOut />
    </div>
  );
}

/** The finish of the workflow, with a run order in and, after a run, its result. */
export function EndNode({ data }: NodeProps<FlowNode<EndGraphNode>>) {
  return (
    <div
      className="wf-node wf-node-end"
      data-testid="node-end"
      data-state={data.status?.state}
    >
      <NodeShape height={NODE_HEIGHT.end} radius={NODE_HEIGHT.end / 2} />
      <SequenceIn />
      <div className="wf-node-title">end</div>
      <StatusBadge status={data.status} />
    </div>
  );
}
