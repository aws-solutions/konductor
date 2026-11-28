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
import {
  useCallback,
  useMemo,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CanvasGraph } from '../graph';
import './canvas.css';
import { AGENT_DRAG_TYPE } from './agent-drag';
import { READ_ONLY_ARIA_LABELS, SELECTABLE_ARIA_LABELS } from './aria-labels';
import { FitWhenGrown } from './FitWhenGrown';
import { IntentNode, StageNode } from './nodes';
import { markSelectable } from './selection';
import { CANVAS_HEIGHT, FIT_PADDING, MIN_ZOOM } from './view';

const NODE_TYPES: NodeTypes = {
  intent: IntentNode,
  stage: StageNode,
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
  /** Opens the workflow parameter editor from the intent card. */
  onParams?(): void;
}

/** Adds an agent stage at the drop position. */
export interface CanvasInsertion {
  disabledReason?: string;
  onInsert(index: number, agent: string): void;
}

function stageElements(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>('.react-flow__node-stage'),
  ].sort(
    (left, right) =>
      left.getBoundingClientRect().top - right.getBoundingClientRect().top,
  );
}

function dropIndex(root: HTMLElement, y: number): number {
  const stages = stageElements(root);
  const found = stages.findIndex((stage) => {
    const bounds = stage.getBoundingClientRect();
    return y < bounds.top + bounds.height / 2;
  });
  return found < 0 ? stages.length : found;
}

function markDrop(root: HTMLElement, index?: number): void {
  const stages = stageElements(root);
  for (const stage of stages) {
    stage.classList.remove('wf-drop-before', 'wf-drop-after');
  }
  if (index === undefined || stages.length === 0) return;
  const target = stages[index];
  if (target) target.classList.add('wf-drop-before');
  else stages.at(-1)?.classList.add('wf-drop-after');
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
  insertion,
}: {
  graph: CanvasGraph;
  selection?: CanvasSelection;
  insertion?: CanvasInsertion;
}) {
  const selectedId = selection?.selectedId;
  const onSelect = selection?.onSelect;
  const onParams = selection?.onParams;
  const nodes = useMemo(
    () => (onSelect ? markSelectable(graph.nodes, selectedId) : graph.nodes),
    [graph.nodes, onSelect, selectedId],
  );
  const onClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        onParams &&
        target instanceof HTMLElement &&
        target.closest('[data-intent-params="true"]')
      ) {
        onParams();
      }
    },
    [onParams],
  );
  // The nodes carry React Flow's `nokey` class (see markSelectable), so it
  // leaves their keys alone: Escape no longer drops focus, and a key is not
  // stopped on its way to the page. Enter or Space on a stage chooses it here,
  // also when it is the selected one already.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const node = event.target;
      if (!onSelect || !(node instanceof HTMLElement)) return;
      if (!node.classList.contains('react-flow__node-stage')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onSelect(node.dataset.id ?? '');
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
  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (
        !insertion ||
        insertion.disabledReason ||
        !event.dataTransfer.types.includes(AGENT_DRAG_TYPE)
      ) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      markDrop(
        event.currentTarget,
        dropIndex(event.currentTarget, event.clientY),
      );
    },
    [insertion],
  );
  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
      markDrop(event.currentTarget);
    }
  }, []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!insertion || insertion.disabledReason) return;
      const agent = event.dataTransfer.getData(AGENT_DRAG_TYPE);
      if (!agent) return;
      event.preventDefault();
      const index = dropIndex(event.currentTarget, event.clientY);
      markDrop(event.currentTarget);
      insertion.onInsert(index, agent);
    },
    [insertion],
  );
  return (
    <div
      className="wf-canvas"
      role="region"
      aria-label="Workflow graph"
      style={{ height: CANVAS_HEIGHT }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={insertion?.disabledReason}
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
