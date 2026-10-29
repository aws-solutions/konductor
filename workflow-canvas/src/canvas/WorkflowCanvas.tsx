// SPDX-License-Identifier: Apache-2.0
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type DefaultEdgeOptions,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CanvasGraph } from '../graph';
import './canvas.css';
import { READ_ONLY_ARIA_LABELS } from './aria-labels';
import { EndNode, IntentNode, StageNode } from './nodes';
import { CANVAS_HEIGHT, FIT_PADDING, MIN_ZOOM } from './view';

const NODE_TYPES: NodeTypes = {
  intent: IntentNode,
  stage: StageNode,
  end: EndNode,
};

const EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'straight',
  style: { stroke: 'var(--wf-edge)', strokeWidth: 2.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: 'var(--wf-edge)',
    width: 16,
    height: 16,
  },
};

/**
 * Draws a workflow graph, read-only. The view can be panned and zoomed, but
 * nodes cannot be moved, selected, connected or edited. Each node can still
 * be reached with the Tab key, which also brings it into view.
 */
export function WorkflowCanvas({ graph }: { graph: CanvasGraph }) {
  return (
    <div
      className="wf-canvas"
      role="region"
      aria-label="Workflow graph"
      style={{ height: CANVAS_HEIGHT }}
    >
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        ariaLabelConfig={READ_ONLY_ARIA_LABELS}
        zoomOnScroll={false}
        preventScrolling={false}
        minZoom={MIN_ZOOM}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--wf-canvas-dots)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
