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

/** The port where run order arrives, at the top right of a node. */
function SequenceIn() {
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={SEQUENCE_IN}
      isConnectable={false}
      className="wf-port wf-port-in"
    >
      <span aria-hidden="true">S</span>
    </Handle>
  );
}

/** The port where run order leaves, at the bottom right of a node. */
function SequenceOut() {
  return (
    <Handle
      type="source"
      position={Position.Bottom}
      id={SEQUENCE_OUT}
      isConnectable={false}
      className="wf-port wf-port-out"
    >
      <span aria-hidden="true">S</span>
    </Handle>
  );
}

/** The start of the workflow: the outcome it is for, with a run order out. */
export function IntentNode({ data }: NodeProps<FlowNode<IntentGraphNode>>) {
  return (
    <div className="wf-node wf-node-intent" data-testid="node-intent">
      <div className="wf-node-title">intent</div>
      <div className="wf-node-intent-outcome">{data.outcome}</div>
      <SequenceOut />
    </div>
  );
}

/** One stage: its name, then its agent and harness, with run order in and out. */
export function StageNode({ data }: NodeProps<FlowNode<StageGraphNode>>) {
  return (
    <div className="wf-node" data-testid={`node-stage-${data.name}`}>
      <SequenceIn />
      <div className="wf-node-title">{data.name}</div>
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
      <SequenceIn />
      <div className="wf-node-title">end</div>
    </div>
  );
}
