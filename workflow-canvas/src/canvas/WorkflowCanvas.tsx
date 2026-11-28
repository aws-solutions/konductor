// SPDX-License-Identifier: Apache-2.0
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  type Connection,
  type DefaultEdgeOptions,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { CanvasGraph, GraphEdge } from '../graph';
import './canvas.css';
import { AGENT_DRAG_TYPE } from './agent-drag';
import { READ_ONLY_ARIA_LABELS, SELECTABLE_ARIA_LABELS } from './aria-labels';
import { DataLoopEdge } from './DataLoopEdge';
import { FitWhenGrown } from './FitWhenGrown';
import { IntentNode, StageNode } from './nodes';
import { markSelectable } from './selection';
import { CANVAS_HEIGHT, FIT_PADDING, MIN_ZOOM } from './view';

const NODE_TYPES: NodeTypes = {
  intent: IntentNode,
  stage: StageNode,
};

const EDGE_TYPES: EdgeTypes = {
  'data-loop': DataLoopEdge,
};

const EDGE_OPTIONS: DefaultEdgeOptions = {
  type: 'straight',
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
  /** Moves focus from a stage problem summary to the full findings. */
  onProblems?(nodeId: string): void;
  /** Opens the workflow parameter editor from the intent card. */
  onParams?(): void;
  /** Opens the intent acceptance-check editor. */
  onChecks?(): void;
}

/** Creates and removes data links between stages. */
export interface CanvasLinking {
  disabledReason?: string;
  deleteBlocker?(
    sourceNodeId: string,
    targetNodeId: string,
    output: string,
    generated: boolean,
  ): string | undefined;
  onLink?(sourceNodeId: string, targetNodeId: string): void;
  onDelete(
    sourceNodeId: string,
    targetNodeId: string,
    output: string,
    generated: boolean,
  ): void;
}

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
 * cannot be moved. With `linking`, stage data ports can be connected and
 * selected data edges can be deleted. With `selection`, a stage can be chosen
 * by a click, Enter or Space; without it the canvas is read-only. Each node
 * can be reached with the Tab key, which also brings it into view.
 */
export function WorkflowCanvas({
  graph,
  selection,
  insertion,
  linking,
}: {
  graph: CanvasGraph;
  selection?: CanvasSelection;
  insertion?: CanvasInsertion;
  linking?: CanvasLinking;
}) {
  const selectedId = selection?.selectedId;
  const onSelect = selection?.onSelect;
  const onProblems = selection?.onProblems;
  const onParams = selection?.onParams;
  const onChecks = selection?.onChecks;
  const root = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const selectedLink = graph.edges.find(
    (edge) => edge.id === selectedEdgeId && edge.output !== undefined,
  );
  const deleteReason = useCallback(
    (edge: GraphEdge | undefined) =>
      edge?.output
        ? (linking?.disabledReason ??
          linking?.deleteBlocker?.(
            edge.source,
            edge.target,
            edge.output,
            edge.generated === true,
          ))
        : undefined,
    [linking],
  );
  const removeLink = useCallback(
    (edge: GraphEdge | undefined) => {
      if (!edge?.output || deleteReason(edge)) return;
      linking?.onDelete(
        edge.source,
        edge.target,
        edge.output,
        edge.generated === true,
      );
      setSelectedEdgeId(undefined);
      if (edge.generated) {
        requestAnimationFrame(() => {
          stageElements(root.current ?? document.body)
            .find((stage) => stage.dataset.id === edge.target)
            ?.focus();
        });
      }
    },
    [deleteReason, linking],
  );
  const edges = useMemo(
    () =>
      graph.edges.map((edge) =>
        edge.output
          ? {
              ...edge,
              className: 'wf-data-edge',
              deletable: deleteReason(edge) === undefined,
              focusable: true,
              selectable: true,
              selected: edge.id === selectedEdgeId,
            }
          : {
              ...edge,
              deletable: false,
              focusable: false,
              selectable: false,
            },
      ),
    [deleteReason, graph.edges, selectedEdgeId],
  );
  const nodes = useMemo(
    () => (onSelect ? markSelectable(graph.nodes, selectedId) : graph.nodes),
    [graph.nodes, onSelect, selectedId],
  );
  const onClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const problem = target.closest<HTMLElement>(
        '[data-stage-problems="true"]',
      );
      if (onProblems && problem) {
        const node = problem.closest<HTMLElement>('.react-flow__node-stage');
        onProblems(node?.dataset.id ?? '');
        return;
      }
      if (onChecks && target.closest('[data-intent-checks="true"]')) {
        onChecks();
        return;
      }
      if (onParams && target.closest('[data-intent-params="true"]')) {
        onParams();
      }
    },
    [onChecks, onParams, onProblems],
  );
  // The nodes carry React Flow's `nokey` class (see markSelectable), so it
  // leaves their keys alone: Escape no longer drops focus, and a key is not
  // stopped on its way to the page. Enter or Space on a stage chooses it here,
  // also when it is the selected one already.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        selectedLink &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        removeLink(selectedLink);
        return;
      }
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      if (
        onProblems &&
        node.closest('[data-stage-problems="true"]') &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault();
        const stage = node.closest<HTMLElement>('.react-flow__node-stage');
        onProblems(stage?.dataset.id ?? '');
        return;
      }
      if (!onSelect) return;
      if (!node.classList.contains('react-flow__node-stage')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onSelect(node.dataset.id ?? '');
    },
    [onProblems, onSelect, removeLink, selectedLink],
  );
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setSelectedEdgeId((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type !== 'select') continue;
        if (change.selected) next = change.id;
        else if (next === change.id) next = undefined;
      }
      return next;
    });
  }, []);
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

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        linking?.onLink?.(connection.source, connection.target);
      }
    },
    [linking],
  );
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        removeLink(graph.edges.find((candidate) => candidate.id === edge.id));
      }
    },
    [graph.edges, removeLink],
  );
  const onEdgeClick = useCallback((_event: MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
  }, []);
  const onEdgeContextMenu = useCallback((event: MouseEvent, edge: Edge) => {
    event.preventDefault();
    setSelectedEdgeId(edge.id);
  }, []);

  const selectedDeleteReason = deleteReason(selectedLink);

  return (
    <div
      ref={root}
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
      {selectedLink && (
        <div className="wf-link-menu">
          <ButtonDropdown
            items={[{ id: 'delete', text: 'Delete link' }]}
            disabled={selectedDeleteReason !== undefined}
            disabledReason={selectedDeleteReason}
            onItemClick={({ detail }) => {
              if (detail.id === 'delete') removeLink(selectedLink);
            }}
          >
            Link actions
          </ButtonDropdown>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={EDGE_OPTIONS}
        nodesDraggable={false}
        nodesConnectable={linking?.onLink !== undefined}
        elementsSelectable={onSelect !== undefined}
        edgesFocusable={linking !== undefined}
        edgesReconnectable={false}
        onConnect={onConnect}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContextMenu}
        onNodesChange={onNodesChange}
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
