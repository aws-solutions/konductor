// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  DATA_IN,
  DATA_OUT,
  NODE_HEIGHT,
  NODE_WIDTH,
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type IntentGraphNode,
  type StageGraphNode,
} from '../graph';
import {
  FOCUS_GAP,
  FOCUS_WIDTH,
  NODE_RADIUS,
  nodeOutline,
  spreadStroke,
} from './card-shape';
import { StopMark } from '../canvas-parts/StopMark';
import { agentColor, agentInitials } from './agent-badge';

type FlowNode<N extends { type: string; data: Record<string, unknown> }> = Node<
  N['data'],
  N['type']
>;

// The always-visible dot where run order enters the top edge.
function SequenceIn() {
  return (
    <Handle
      type="target"
      position={Position.Top}
      id={SEQUENCE_IN}
      isConnectable
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
      isConnectable
      className="wf-port wf-port-out"
    />
  );
}

function DataIn() {
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={DATA_IN}
      isConnectable
      className="wf-data-port wf-data-port-in"
    />
  );
}

function DataOut() {
  return (
    <Handle
      type="source"
      position={Position.Right}
      id={DATA_OUT}
      isConnectable
      className="wf-data-port wf-data-port-out"
    />
  );
}

/**
 * The card behind the content of a node: one rounded outline, with the focus
 * ring and its gap drawn around it.
 */
function NodeShape({
  width,
  height,
  radius,
}: {
  width: number;
  height: number;
  radius: number;
}) {
  const outline = nodeOutline({ width, height, radius });
  return (
    <svg
      className="wf-node-shape"
      width={width}
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

const PARAM_BUTTON_STYLE = {
  root: {
    background: {
      active: 'var(--wf-intent-bg)',
      default: 'var(--wf-intent-bg)',
      hover: 'var(--wf-intent-bg)',
    },
    borderColor: {
      active: 'var(--wf-intent-text)',
      default: 'var(--wf-intent-text)',
      hover: 'var(--wf-intent-text)',
    },
    borderRadius: '999px',
    color: {
      active: 'var(--wf-intent-text)',
      default: 'var(--wf-intent-text)',
      hover: 'var(--wf-intent-text)',
    },
    focusRing: {
      borderColor: 'var(--wf-intent-text)',
      borderRadius: '999px',
    },
  },
};

/** The start of the workflow: the outcome it is for, with a run order out. */
export function IntentNode({ data }: NodeProps<FlowNode<IntentGraphNode>>) {
  return (
    <div className="wf-node wf-node-intent" data-testid="node-intent">
      <NodeShape
        width={NODE_WIDTH.intent}
        height={NODE_HEIGHT.intent}
        radius={NODE_RADIUS.intent}
      />
      <div className="wf-node-title">INTENT</div>
      <div className="wf-node-intent-outcome" title={data.outcome}>
        {data.outcome}
      </div>
      <Box
        className="wf-intent-params-position"
        display="inline-block"
        data-intent-params="true"
      >
        <Button
          variant="normal"
          style={PARAM_BUTTON_STYLE}
          ariaLabel={`params ${data.paramCount}, edit declared parameters`}
          nativeButtonAttributes={{
            className: 'wf-intent-params-control nodrag nopan nowheel nokey',
          }}
        >
          params {data.paramCount}
        </Button>
      </Box>
      <Box
        className="wf-intent-checks-position"
        display="inline-block"
        data-intent-checks="true"
      >
        <Button
          variant="normal"
          style={PARAM_BUTTON_STYLE}
          ariaLabel={`checks ${data.checkCount}, edit acceptance checks`}
          nativeButtonAttributes={{
            className: 'wf-intent-checks-control nodrag nopan nowheel nokey',
          }}
        >
          checks {data.checkCount}
        </Button>
      </Box>
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
      <NodeShape
        width={NODE_WIDTH.stage}
        height={NODE_HEIGHT.stage}
        radius={NODE_RADIUS.stage}
      />
      <SequenceIn />
      <DataIn />
      <DataOut />
      <div
        className="wf-agent-badge"
        data-color={agentColor(data.agent)}
        aria-hidden="true"
      >
        {agentInitials(data.agent)}
      </div>
      <div className="wf-stage-copy">
        <div className="wf-node-title" title={data.name}>
          {data.name}
        </div>
        <div className="wf-node-sub" title={`${data.agent} · ${data.harness}`}>
          {data.agent} · {data.harness}
        </div>
        {data.description && (
          <div className="wf-node-description" title={data.descriptionTitle}>
            {data.description}
          </div>
        )}
        {data.problem && (
          <div
            className="wf-stage-problem"
            title={data.problem}
            role="button"
            tabIndex={0}
            data-stage-problems="true"
            aria-label={`Show ${data.problemCount ?? 1} ${data.problemCount === 1 ? 'finding' : 'findings'} for stage ${data.name}`}
          >
            {data.problem}
          </div>
        )}
      </div>
      {data.endsRun ? (
        <span className="wf-node-stop">
          <StopMark stage={data.name} state={data.stopState} />
        </span>
      ) : (
        <SequenceOut />
      )}
    </div>
  );
}
