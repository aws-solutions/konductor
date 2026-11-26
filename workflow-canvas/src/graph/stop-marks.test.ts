// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGraph, stageNodeId } from './build-graph';
import { withStopMarks } from './stop-marks';
import {
  SEQUENCE_IN,
  SEQUENCE_OUT,
  type CanvasGraph,
  type GraphEdge,
  type GraphNode,
  type StageGraphNode,
  type StopMarkState,
} from './model';

const spec = (...names: string[]) => ({
  name: 'hello',
  intent: { outcome: 'Say hello' },
  stages: names.map((name) => ({ name, agent: 'k-developer' })),
});

const place = { x: 0, y: 0 };

function stage(name: string): GraphNode {
  return {
    id: stageNodeId(name),
    ariaLabel: `Stage ${name}`,
    type: 'stage',
    position: place,
    width: 280,
    height: 72,
    data: { name, agent: 'k-developer', harness: 'kiro-cli' },
  };
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

// A graph that forks: one stage, then two that follow it and nothing else.
// The builder draws a line, so this one is by hand.
function forked(): CanvasGraph {
  return {
    nodes: [stage('plan'), stage('left'), stage('right')],
    edges: [
      edge(stageNodeId('plan'), stageNodeId('left')),
      edge(stageNodeId('plan'), stageNodeId('right')),
    ],
  };
}

const stages = (graph: CanvasGraph): StageGraphNode[] =>
  graph.nodes.filter((node): node is StageGraphNode => node.type === 'stage');

const marks = (graph: CanvasGraph) =>
  stages(graph)
    .filter((node) => node.data.endsRun)
    .map((node) => node.data.name);

describe('withStopMarks', () => {
  it('marks the last stage of a line', () => {
    const graph = withStopMarks(
      buildGraph(spec('draft', 'review'), 'kiro-cli'),
    );

    expect(marks(graph)).toEqual(['review']);
  });

  it('marks the one stage of a workflow that has one', () => {
    const graph = withStopMarks(buildGraph(spec('only'), 'kiro-cli'));

    expect(marks(graph)).toEqual(['only']);
  });

  it('marks every leaf of a fork', () => {
    expect(marks(withStopMarks(forked()))).toEqual(['left', 'right']);
  });

  it('leaves a stage that another stage follows unmarked', () => {
    const marked = stages(withStopMarks(forked()));

    expect(
      marked.find((node) => node.data.name === 'plan')?.data,
    ).not.toHaveProperty('endsRun');
  });

  it('keeps the edges of the graph as they are', () => {
    const graph = withStopMarks(forked());

    expect(graph.edges.map((one) => one.id)).toEqual([
      'stage-plan->stage-left',
      'stage-plan->stage-right',
    ]);
  });

  it('keeps the places of the nodes', () => {
    const line = buildGraph(spec('draft', 'review'), 'kiro-cli');

    const after = withStopMarks(line).nodes;

    expect(after.map((node) => node.position)).toEqual(
      line.nodes.map((node) => node.position),
    );
  });

  it('gives each leaf the state of its mark when one is known', () => {
    const states = new Map<string, StopMarkState>([
      [stageNodeId('left'), 'passed'],
      [stageNodeId('right'), 'not-reached'],
    ]);

    const marked = stages(withStopMarks(forked(), states));

    expect(marked.map((node) => node.data.stopState)).toEqual([
      undefined,
      'passed',
      'not-reached',
    ]);
  });

  it('leaves the state out of a leaf that has none', () => {
    const graph = withStopMarks(buildGraph(spec('only'), 'kiro-cli'));

    expect(stages(graph)[0]?.data).not.toHaveProperty('stopState');
  });

  it('clears the state of a leaf that is no longer known', () => {
    const states = new Map<string, StopMarkState>([
      [stageNodeId('left'), 'passed'],
    ]);
    const before = withStopMarks(forked(), states);

    const after = withStopMarks(before);

    expect(stages(before)[1]?.data.stopState).toBe('passed');
    expect(stages(after)[1]?.data).not.toHaveProperty('stopState');
    expect(marks(after)).toEqual(['left', 'right']);
  });

  it('takes the mark off a leaf that another stage now follows', () => {
    const marked = withStopMarks(
      forked(),
      new Map([[stageNodeId('left'), 'passed' as StopMarkState]]),
    );

    // The person joined a new stage after `left`, so it is not a leaf now.
    const grown = withStopMarks({
      nodes: [...marked.nodes, stage('wrap-up')],
      edges: [
        ...marked.edges,
        edge(stageNodeId('left'), stageNodeId('wrap-up')),
      ],
    });

    expect(marks(grown)).toEqual(['right', 'wrap-up']);
    const left = stages(grown).find((node) => node.data.name === 'left');
    expect(left?.data).not.toHaveProperty('endsRun');
    expect(left?.data).not.toHaveProperty('stopState');
  });
});

describe('buildGraph', () => {
  it('draws the intent and the stages, with a mark on the last one', () => {
    const graph = buildGraph(spec('draft', 'review'), 'kiro-cli');

    expect(graph.nodes.map((node) => node.type)).toEqual([
      'intent',
      'stage',
      'stage',
    ]);
    expect(marks(graph)).toEqual(['review']);
  });

  it('joins the stages of a line in run order', () => {
    const graph = buildGraph(spec('draft', 'review'), 'kiro-cli');

    expect(graph.edges.map((one) => one.id)).toEqual([
      'intent->stage-draft',
      'stage-draft->stage-review',
    ]);
  });

  it('marks the only stage of a workflow that has one', () => {
    const graph = buildGraph(spec('only'), 'kiro-cli');

    expect(marks(graph)).toEqual(['only']);
    expect(graph.edges.map((one) => one.id)).toEqual(['intent->stage-only']);
  });
});
