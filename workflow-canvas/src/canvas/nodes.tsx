// SPDX-License-Identifier: Apache-2.0
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type IntentGraphNode,
  type StageGraphNode,
} from '../graph';

type FlowNode<N extends { type: string; data: Record<string, unknown> }> = Node<
  N['data'],
  N['type']
>;

// The outline of a run order port, as a tab seen from the card and as a notch.
// A tab and a notch share it, so one fits the other.
const PORT_OUTLINE = 'M9.5 0V4H7V16H19V4H16.5V0Z';
const PORT_OPENING = 'M9.5 0V4H7V16H19V4H16.5V0';

function PortShape({ kind }: { kind: 'tab' | 'notch' }) {
  return (
    <>
      <svg
        className="wf-port-svg"
        viewBox="0 0 26 16"
        aria-hidden="true"
        focusable="false"
      >
        <path className="wf-port-rim" d={PORT_OUTLINE} />
        {kind === 'notch' && (
          <>
            <path className="wf-port-inner" d={PORT_OUTLINE} />
            <path className="wf-port-ring" d={PORT_OPENING} />
          </>
        )}
      </svg>
      <span className="wf-port-letter" aria-hidden="true">
        S
      </span>
    </>
  );
}

// The port where run order arrives: a notch at the top right of a node.
function SequenceIn() {
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={SEQUENCE_IN}
      isConnectable={false}
      className="wf-port wf-port-in"
    >
      <PortShape kind="notch" />
    </Handle>
  );
}

// The port where run order leaves: a tab at the bottom right of a node.
function SequenceOut() {
  return (
    <Handle
      type="source"
      position={Position.Bottom}
      id={SEQUENCE_OUT}
      isConnectable={false}
      className="wf-port wf-port-out"
    >
      <PortShape kind="tab" />
    </Handle>
  );
}

/** The start of the workflow: the outcome it is for, with a run order out. */
export function IntentNode({ data }: NodeProps<FlowNode<IntentGraphNode>>) {
  return (
    <div className="wf-node wf-node-intent" data-testid="node-intent">
      <div className="wf-node-title">intent</div>
      <div className="wf-node-intent-outcome" title={data.outcome}>
        {data.outcome}
      </div>
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
      <SequenceIn />
      <div className="wf-node-title" title={data.name}>
        {data.name}
      </div>
      <div className="wf-node-sub" title={`${data.agent} · ${data.harness}`}>
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
      <SequenceIn />
      <div className="wf-node-title">end</div>
    </div>
  );
}
