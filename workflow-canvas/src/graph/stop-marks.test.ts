// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { END_ID, buildGraph, stageNodeId } from './build-graph';
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

function end(): GraphNode {
  return {
    id: END_ID,
    ariaLabel: 'End',
    type: 'end',
    position: place,
    width: 280,
    height: 48,
    data: {},
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

// A graph that forks: one stage, then two that follow it and nothing else,
// each joined to the end. The builder draws a line, so this one is by hand.
function forked(): CanvasGraph {
  return {
    nodes: [stage('plan'), stage('left'), stage('right'), end()],
    edges: [
      edge(stageNodeId('plan'), stageNodeId('left')),
      edge(stageNodeId('plan'), stageNodeId('right')),
      edge(stageNodeId('left'), END_ID),
      edge(stageNodeId('right'), END_ID),
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
  it('marks the last stage of a line and drops the end node', () => {
    const graph = withStopMarks(
      buildGraph(spec('draft', 'review'), 'kiro-cli'),
    );

    expect(marks(graph)).toEqual(['review']);
    expect(graph.nodes.some((node) => node.type === 'end')).toBe(false);
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

  it('drops the edges that went to the end node', () => {
    const graph = withStopMarks(forked());

    expect(graph.edges.map((one) => one.id)).toEqual([
      'stage-plan->stage-left',
      'stage-plan->stage-right',
    ]);
  });

  it('keeps the places of the nodes that stay', () => {
    const line = buildGraph(spec('draft', 'review'), 'kiro-cli');
    const before = line.nodes.filter((node) => node.type !== 'end');

    const after = withStopMarks(line).nodes;

    expect(after.map((node) => node.position)).toEqual(
      before.map((node) => node.position),
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

  it('marks a graph that has no end node already', () => {
    const { nodes, edges } = forked();
    const withoutEnd = {
      nodes: nodes.filter((node) => node.type !== 'end'),
      edges: edges.filter((one) => one.target !== END_ID),
    };

    expect(marks(withStopMarks(withoutEnd))).toEqual(['left', 'right']);
  });
});

describe('buildGraph with stopMarks', () => {
  it('draws the stop marks instead of the end node', () => {
    const graph = buildGraph(spec('draft', 'review'), 'kiro-cli', {
      stopMarks: true,
    });

    expect(graph.nodes.map((node) => node.type)).toEqual([
      'intent',
      'stage',
      'stage',
    ]);
    expect(marks(graph)).toEqual(['review']);
  });

  it('joins the stages of a line in run order', () => {
    const graph = buildGraph(spec('draft', 'review'), 'kiro-cli', {
      stopMarks: true,
    });

    expect(graph.edges.map((one) => one.id)).toEqual([
      'intent->stage-draft',
      'stage-draft->stage-review',
    ]);
  });

  it('marks the only stage of a workflow that has one', () => {
    const graph = buildGraph(spec('only'), 'kiro-cli', { stopMarks: true });

    expect(marks(graph)).toEqual(['only']);
    expect(graph.edges.map((one) => one.id)).toEqual(['intent->stage-only']);
  });

  it('keeps the end node for a caller that does not ask for the marks', () => {
    const graph = buildGraph(spec('draft', 'review'), 'kiro-cli');

    expect(graph.nodes.at(-1)?.type).toBe('end');
    expect(marks(graph)).toEqual([]);
  });

  it('places the stages where it does without the marks', () => {
    const plain = buildGraph(spec('draft', 'review'), 'kiro-cli');
    const marked = buildGraph(spec('draft', 'review'), 'kiro-cli', {
      stopMarks: true,
    });

    expect(marked.nodes.map((node) => node.position)).toEqual(
      plain.nodes.filter((node) => node.type !== 'end').map((n) => n.position),
    );
  });
});
