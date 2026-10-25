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
import { EndNode, IntentNode, StageNode } from './nodes';

const NODE_TYPES: NodeTypes = {
  intent: IntentNode,
  stage: StageNode,
  end: EndNode,
};

const EDGE_COLOR = '#5f6b7a';

const EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'straight',
  style: { stroke: EDGE_COLOR, strokeWidth: 2.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: EDGE_COLOR,
    width: 16,
    height: 16,
  },
};

const DOT_COLOR = '#c9c1b3';

/**
 * Draws a workflow graph, read-only. The view can be panned and zoomed, but
 * nodes cannot be moved, selected, connected or edited.
 */
export function WorkflowCanvas({ graph }: { graph: CanvasGraph }) {
  return (
    <div className="wf-canvas" role="region" aria-label="Workflow graph">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        minZoom={0.4}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      >
        <Background variant={BackgroundVariant.Dots} color={DOT_COLOR} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
