// SPDX-License-Identifier: Apache-2.0
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type DefaultEdgeOptions,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, type KeyboardEvent } from 'react';
import type { CanvasGraph } from '../graph';
import './canvas.css';
import { READ_ONLY_ARIA_LABELS, SELECTABLE_ARIA_LABELS } from './aria-labels';
import { FitWhenGrown } from './FitWhenGrown';
import { EndNode, IntentNode, StageNode } from './nodes';
import { markSelectable } from './selection';
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

/** Which stage is selected and what to do when another one is chosen. */
export interface CanvasSelection {
  /** The id of the selected node. */
  selectedId: string | undefined;
  /**
   * Called with the id of the stage node that was clicked, or chosen with
   * Enter or Space, also when it is the selected one already.
   */
  onSelect(nodeId: string): void;
}

/**
 * Draws a workflow graph. The view can be panned and zoomed, but nodes
 * cannot be moved or connected. With `selection`, a stage can be chosen by a
 * click, or with the keyboard, Enter or Space on the node; without it the
 * canvas is read-only. Each node can be reached with the Tab key, which also
 * brings it into view.
 */
export function WorkflowCanvas({
  graph,
  selection,
}: {
  graph: CanvasGraph;
  selection?: CanvasSelection;
}) {
  const selectedId = selection?.selectedId;
  const onSelect = selection?.onSelect;
  const nodes = useMemo(
    () => (onSelect ? markSelectable(graph.nodes, selectedId) : graph.nodes),
    [graph.nodes, onSelect, selectedId],
  );
  // React Flow selects a node only when it is not selected yet, and Escape
  // makes it drop focus. Both are taken here, before it sees them: Enter or
  // Space always chooses the stage, and Escape leaves focus where it is. A
  // canvas that cannot select keeps the default of both.
  const onKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      if (!node.classList.contains('react-flow__node')) return;
      if (event.key === 'Escape') {
        if (onSelect) event.stopPropagation();
        return;
      }
      const choose = event.key === 'Enter' || event.key === ' ';
      if (
        choose &&
        onSelect &&
        node.classList.contains('react-flow__node-stage')
      ) {
        event.preventDefault();
        event.stopPropagation();
        onSelect(node.dataset.id ?? '');
      }
    },
    [onSelect],
  );
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) onSelect?.(change.id);
      }
    },
    [onSelect],
  );
  return (
    <div
      className="wf-canvas"
      role="region"
      aria-label="Workflow graph"
      style={{ height: CANVAS_HEIGHT }}
      onKeyDownCapture={onKeyDownCapture}
    >
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={NODE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={onSelect !== undefined}
        onNodesChange={onNodesChange}
        edgesFocusable={false}
        ariaLabelConfig={
          onSelect ? SELECTABLE_ARIA_LABELS : READ_ONLY_ARIA_LABELS
        }
        zoomOnScroll={false}
        preventScrolling={false}
        minZoom={MIN_ZOOM}
        fitView
        fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1 }}
      >
        <FitWhenGrown count={graph.nodes.length} />
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--wf-canvas-dots)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
