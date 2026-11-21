// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGraph, END_ID, stageNodeId } from './build-graph';
import {
  leafStages,
  stopMarkState,
  type LeafRunStatus,
  type LeafStageStatus,
  type StopMarkState,
} from './leaf-stages';
import {
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type CanvasGraph,
  type GraphEdge,
} from './model';

function graphOf(...names: string[]): CanvasGraph {
  return buildGraph(
    {
      name: 'hello',
      intent: { outcome: 'Add a greeting' },
      stages: names.map((name) => ({ name, agent: 'k-developer' })),
    },
    'kiro-cli',
  );
}

function edge(source: string, target: string): GraphEdge {
  return {
    id: `${source}->${target}`,
    ariaLabel: `Run order from ${source} to ${target}`,
    source,
    target,
    sourceHandle: SEQUENCE_OUT,
    targetHandle: SEQUENCE_IN,
  };
}

// The graph with no end node and no edge into it, as the page will draw it.
function withoutEnd(graph: CanvasGraph): CanvasGraph {
  return {
    nodes: graph.nodes.filter((node) => node.id !== END_ID),
    edges: graph.edges.filter((e) => e.target !== END_ID),
  };
}

describe('leafStages', () => {
  it('finds the last stage of a workflow in list order', () => {
    expect(leafStages(graphOf('draft', 'review', 'ship'))).toEqual([
      stageNodeId('ship'),
    ]);
  });

  it('finds the one stage of a workflow of one stage', () => {
    expect(leafStages(graphOf('draft'))).toEqual([stageNodeId('draft')]);
  });

  it('gives the same answer without the end node', () => {
    const graph = graphOf('draft', 'review');

    expect(leafStages(withoutEnd(graph))).toEqual(leafStages(graph));
  });

  it('finds every stage that ends a branch, in node order', () => {
    const base = withoutEnd(graphOf('plan', 'build', 'docs', 'ship'));
    const [plan, build, docs, ship] = ['plan', 'build', 'docs', 'ship'].map(
      stageNodeId,
    );
    const graph = {
      nodes: base.nodes,
      edges: [
        edge('intent', plan!),
        edge(plan!, build!),
        edge(plan!, docs!),
        edge(build!, ship!),
      ],
    };

    expect(leafStages(graph)).toEqual([docs, ship]);
  });

  it('does not take an edge from a stage to itself for a follower', () => {
    const base = withoutEnd(graphOf('draft'));
    const draft = stageNodeId('draft');

    expect(
      leafStages({ ...base, edges: [...base.edges, edge(draft, draft)] }),
    ).toEqual([draft]);
  });

  it('finds none in a graph with no stages', () => {
    expect(leafStages({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe('stopMarkState', () => {
  it.each<[LeafStageStatus, LeafRunStatus, StopMarkState | undefined]>([
    ['passed', 'passed', 'passed'],
    ['passed', 'running', 'passed'],
    ['passed', 'halted', 'passed'],
    ['blocked', 'halted', 'blocked'],
    ['pending', 'halted', 'not-reached'],
    ['running', 'halted', 'not-reached'],
    ['pending', 'running', undefined],
    ['running', 'running', undefined],
  ])('shows a %s stage of a %s run as %s', (stage, run, state) => {
    expect(stopMarkState(stage, run)).toBe(state);
  });
});
