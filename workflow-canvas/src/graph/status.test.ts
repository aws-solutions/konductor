// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGraph } from './build-graph';
import type { NodeStatus, WorkflowSpec } from './model';
import { withStatuses } from './status';

const HELLO: WorkflowSpec = {
  name: 'hello',
  intent: { outcome: 'Add a greeting to the README' },
  stages: [
    { name: 'draft', agent: 'k-developer' },
    { name: 'review', agent: 'k-quality-assurance' },
  ],
};

const RUNNING: NodeStatus = { state: 'running', label: 'Running' };
const PASSED: NodeStatus = { state: 'done', label: 'Passed' };

describe('withStatuses', () => {
  const graph = buildGraph(HELLO, 'kiro-cli');

  it('puts the status in the data of the node it names', () => {
    const { nodes } = withStatuses(graph, new Map([['stage-draft', RUNNING]]));

    expect(nodes.find((node) => node.id === 'stage-draft')?.data).toEqual({
      name: 'draft',
      agent: 'k-developer',
      harness: 'kiro-cli',
      status: RUNNING,
    });
  });

  it('says the status in the name a screen reader reads', () => {
    const { nodes } = withStatuses(
      graph,
      new Map([
        ['stage-draft', RUNNING],
        ['end', PASSED],
      ]),
    );

    expect(nodes.map((node) => node.ariaLabel)).toEqual([
      'Intent: Add a greeting to the README',
      'Stage draft, agent k-developer, harness kiro-cli, running',
      'Stage review, agent k-quality-assurance, harness kiro-cli',
      'End, passed',
    ]);
  });

  it('leaves the other nodes, the edges and the positions as they were', () => {
    const next = withStatuses(graph, new Map([['end', PASSED]]));

    expect(next.edges).toBe(graph.edges);
    expect(next.nodes[0]).toBe(graph.nodes[0]);
    expect(next.nodes.map((node) => node.position)).toEqual(
      graph.nodes.map((node) => node.position),
    );
  });

  it('does not change the graph it is given', () => {
    withStatuses(graph, new Map([['end', PASSED]]));

    expect(graph.nodes.at(-1)?.data).toEqual({});
    expect(graph.nodes.at(-1)?.ariaLabel).toBe('End');
  });

  it('ignores an id that no node has', () => {
    const next = withStatuses(graph, new Map([['stage-nope', RUNNING]]));

    expect(next.nodes).toEqual(graph.nodes);
  });
});
