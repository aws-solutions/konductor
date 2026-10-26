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
  IN_HANDLE_STYLE,
  LETTER_Y,
  NOTCH_RING,
  NOTCH_TOP,
  OUT_HANDLE_STYLE,
  PORT_SHAPE,
  PORT_WIDTH,
  RIM_WIDTH,
  RING_WIDTH,
  nodeOutline,
  portTransform,
  rimSpreadStroke,
  spreadStroke,
  tabTop,
} from './jigsaw';

type FlowNode<N extends { type: string; data: Record<string, unknown> }> = Node<
  N['data'],
  N['type']
>;

// The port where run order arrives. The handle is only the box that the link
// measures from; the notch itself is drawn by `NodeShape`.
function SequenceIn() {
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={SEQUENCE_IN}
      isConnectable={false}
      className="wf-port"
      style={IN_HANDLE_STYLE}
    />
  );
}

// The port where run order leaves, with its tab drawn by `NodeShape`.
function SequenceOut() {
  return (
    <Handle
      type="source"
      position={Position.Bottom}
      id={SEQUENCE_OUT}
      isConnectable={false}
      className="wf-port"
      style={OUT_HANDLE_STYLE}
    />
  );
}

// The letter of a port, in the body of its tab or notch.
function PortLetter({ kind }: { kind: 'tab' | 'notch' }) {
  return (
    <text
      className={`wf-port-letter wf-port-letter-${kind}`}
      x={PORT_WIDTH / 2}
      y={LETTER_Y}
    >
      S
    </text>
  );
}

// The notch where run order arrives: a dark rim, a white inside and a ring in
// the colour of the tab that fits it, open at the border.
function Notch() {
  return (
    <g className="wf-port-notch" transform={portTransform(NOTCH_TOP)}>
      <path className="wf-port-rim" strokeWidth={RIM_WIDTH} d={PORT_SHAPE} />
      <path className="wf-port-notch-inside" d={PORT_SHAPE} />
      <path
        className="wf-port-notch-ring"
        strokeWidth={RING_WIDTH}
        d={NOTCH_RING}
      />
      <PortLetter kind="notch" />
    </g>
  );
}

// The tab where run order leaves: the same outline as the notch, filled.
function Tab({ top }: { top: number }) {
  return (
    <g className="wf-port-tab" transform={portTransform(top)}>
      <path className="wf-port-rim" strokeWidth={RIM_WIDTH} d={PORT_SHAPE} />
      <path className="wf-port-tab-body" d={PORT_SHAPE} />
      <PortLetter kind="tab" />
    </g>
  );
}

/** The state of a node in a run, as a word in a coloured pill. */
function StatusBadge({ status }: { status: NodeStatus | undefined }) {
  if (!status) return null;
  return (
    <span className="wf-badge" data-testid="status-badge">
      {status.label}
    </span>
  );
}

/**
 * The card behind the content of a node: one rounded outline, with a notch
 * just inside the top edge when run order comes in and a tab hanging from the
 * bottom edge when it goes out. A tab fits the notch of the node below it.
 * The focus ring is drawn around the card and the tab, so it follows the tab.
 */
function NodeShape({
  height,
  radius,
  notch,
  tab,
}: {
  height: number;
  radius: number;
  notch: boolean;
  tab: boolean;
}) {
  const outline = nodeOutline({ width: NODE_WIDTH, height, radius });
  const tabAt = tabTop(height);
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
      {tab && (
        <path
          className="wf-focus-ring-port"
          strokeWidth={rimSpreadStroke(FOCUS_GAP + FOCUS_WIDTH)}
          transform={portTransform(tabAt)}
          d={PORT_SHAPE}
        />
      )}
      <path
        className="wf-focus-gap"
        strokeWidth={spreadStroke(FOCUS_GAP)}
        d={outline}
      />
      {tab && (
        <path
          className="wf-focus-gap"
          strokeWidth={rimSpreadStroke(FOCUS_GAP)}
          transform={portTransform(tabAt)}
          d={PORT_SHAPE}
        />
      )}
      <path className="wf-node-body" d={outline} />
      {notch && <Notch />}
      {tab && <Tab top={tabAt} />}
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
      <NodeShape
        height={NODE_HEIGHT.intent}
        radius={CARD_RADIUS}
        notch={false}
        tab
      />
      <div className="wf-node-title">intent</div>
      <div className="wf-node-intent-outcome">{data.outcome}</div>
      <StatusBadge status={data.status} />
      <SequenceOut />
    </div>
  );
}

/** One stage: its name, then its agent and harness, with run order in and out. */
export function StageNode({ data }: NodeProps<FlowNode<StageGraphNode>>) {
  return (
    <div
      className="wf-node wf-node-stage wf-node-notched"
      data-testid={`node-stage-${data.name}`}
      data-state={data.status?.state}
    >
      <NodeShape height={NODE_HEIGHT.stage} radius={CARD_RADIUS} notch tab />
      <SequenceIn />
      <div className="wf-node-title">{data.name}</div>
      <div className="wf-node-sub">
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
      className="wf-node wf-node-end wf-node-notched"
      data-testid="node-end"
      data-state={data.status?.state}
    >
      <NodeShape
        height={NODE_HEIGHT.end}
        radius={NODE_HEIGHT.end / 2}
        notch
        tab={false}
      />
      <SequenceIn />
      <div className="wf-node-title">end</div>
      <StatusBadge status={data.status} />
    </div>
  );
}
