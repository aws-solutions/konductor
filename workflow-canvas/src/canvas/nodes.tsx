// SPDX-License-Identifier: Apache-2.0
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type IntentGraphNode,
  type StageGraphNode,
} from '../graph';
import {
  BORDER_WIDTH,
  CARD_RADIUS,
  IN_HANDLE_STYLE,
  OUT_HANDLE_STYLE,
  PORT_CLEARANCE,
  PORT_X,
  borderLines,
  letterY,
  nodeOutline,
  pieceShape,
  type OutlineOptions,
} from './jigsaw';

type FlowNode<N extends { type: string; data: Record<string, unknown> }> = Node<
  N['data'],
  N['type']
>;

// The port where run order arrives. The handle is only the box that the link
// measures from; the socket itself is drawn by `NodeShape`.
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

// The port where run order leaves, with its knob drawn by `NodeShape`.
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

// The letter of a port, in the head of its knob or socket.
function PortLetter({ y, kind }: { y: number; kind: 'knob' | 'socket' }) {
  return (
    <text className={`wf-port-letter wf-port-letter-${kind}`} x={PORT_X} y={y}>
      S
    </text>
  );
}

/**
 * The card behind the content of a node: one closed outline, with a socket
 * in the top edge when run order comes in and a knob under the bottom edge
 * when it goes out. A knob fills the socket of the node below it.
 */
function NodeShape({
  height,
  radius,
  socket,
  knob,
}: { height: number; radius: number } & Pick<
  OutlineOptions,
  'socket' | 'knob'
>) {
  const { top, bottom } = borderLines(height);
  return (
    <svg
      className="wf-node-shape"
      width={NODE_WIDTH}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      {socket && <path className="wf-socket" d={pieceShape(top)} />}
      <path
        className="wf-node-body"
        strokeWidth={BORDER_WIDTH}
        d={nodeOutline({ width: NODE_WIDTH, height, radius, socket, knob })}
      />
      {knob && (
        <path
          className="wf-knob"
          strokeWidth={BORDER_WIDTH}
          d={pieceShape(bottom, -1)}
        />
      )}
      {socket && <PortLetter kind="socket" y={letterY(top)} />}
      {knob && <PortLetter kind="knob" y={letterY(bottom)} />}
    </svg>
  );
}

/** The start of the workflow: the outcome it is for, with a run order out. */
export function IntentNode({ data }: NodeProps<FlowNode<IntentGraphNode>>) {
  return (
    <div className="wf-node wf-node-intent" data-testid="node-intent">
      <NodeShape
        height={NODE_HEIGHT.intent}
        radius={CARD_RADIUS}
        socket={false}
        knob
      />
      <div className="wf-node-title">intent</div>
      <div className="wf-node-intent-outcome">{data.outcome}</div>
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
    >
      <NodeShape height={NODE_HEIGHT.stage} radius={CARD_RADIUS} socket knob />
      <SequenceIn />
      {/* A long name stops short of the socket. */}
      <div className="wf-node-title" style={{ paddingRight: PORT_CLEARANCE }}>
        {data.name}
      </div>
      <div className="wf-node-sub">
        {data.agent} · {data.harness}
      </div>
      <SequenceOut />
    </div>
  );
}

/** The finish of the workflow, with a run order in. */
export function EndNode() {
  return (
    <div className="wf-node wf-node-end" data-testid="node-end">
      <NodeShape
        height={NODE_HEIGHT.end}
        radius={NODE_HEIGHT.end / 2}
        socket
        knob={false}
      />
      <SequenceIn />
      <div className="wf-node-title">end</div>
    </div>
  );
}
