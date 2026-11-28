// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGraph, stageNodeId } from './build-graph';
import { NODE_GAP, NODE_HEIGHT, NODE_WIDTH } from './layout';
import type { WorkflowSpec } from './model';

const HELLO: WorkflowSpec = {
  name: 'hello',
  intent: { outcome: 'Add a greeting to the README' },
  stages: [
    { name: 'draft', agent: 'k-developer' },
    { name: 'review', agent: 'k-quality-assurance' },
  ],
};

describe('buildGraph', () => {
  it('draws the intent, then each stage in list order', () => {
    const { nodes } = buildGraph(HELLO, 'kiro-cli');

    expect(nodes.map((node) => [node.id, node.type])).toEqual([
      ['intent', 'intent'],
      ['stage-draft', 'stage'],
      ['stage-review', 'stage'],
    ]);
  });

  it('marks the last stage as the one the run ends after', () => {
    const { nodes } = buildGraph(HELLO, 'kiro-cli');

    expect(nodes.at(-1)).toMatchObject({ data: { endsRun: true } });
    expect(nodes[1]?.data).not.toHaveProperty('endsRun');
  });

  it('keeps the order of the stages as the workflow lists them', () => {
    const reversed = { ...HELLO, stages: [...HELLO.stages].reverse() };

    const ids = buildGraph(reversed, 'kiro-cli').nodes.map((node) => node.id);

    expect(ids).toEqual(['intent', 'stage-review', 'stage-draft']);
  });

  it('gives the intent its outcome', () => {
    const [intent] = buildGraph(HELLO, 'kiro-cli').nodes;

    expect(intent?.data).toEqual({
      outcome: 'Add a greeting to the README',
      paramCount: 0,
      checkCount: 0,
    });
  });

  it('gives each stage its name, its agent and the harness', () => {
    const stages = buildGraph(HELLO, 'kiro-cli').nodes.filter(
      (node) => node.type === 'stage',
    );

    expect(stages.map((node) => node.data)).toEqual([
      { name: 'draft', agent: 'k-developer', harness: 'kiro-cli' },
      {
        name: 'review',
        agent: 'k-quality-assurance',
        harness: 'kiro-cli',
        endsRun: true,
      },
    ]);
  });

  it('uses the stage outcome as its description', () => {
    const graph = buildGraph(
      {
        ...HELLO,
        stages: [
          {
            name: 'draft',
            agent: 'k-developer',
            outcome: 'A greeting in README.md',
            prompt: 'Write the greeting.',
          },
        ],
      },
      'kiro-cli',
    );

    expect(graph.nodes[1]?.data).toMatchObject({
      description: 'A greeting in README.md',
      descriptionTitle: 'A greeting in README.md',
    });
  });

  it('falls back to the first prompt line and keeps the full prompt as its title', () => {
    const graph = buildGraph(
      {
        ...HELLO,
        stages: [
          {
            name: 'draft',
            agent: 'k-developer',
            prompt: 'Write the greeting.\nKeep it short.',
          },
        ],
      },
      'kiro-cli',
    );

    expect(graph.nodes[1]?.data).toMatchObject({
      description: 'Write the greeting.',
      descriptionTitle: 'Write the greeting.\nKeep it short.',
    });
  });

  it('shows no prompt text when the stage reads a prompt file', () => {
    const graph = buildGraph(
      {
        ...HELLO,
        stages: [
          {
            name: 'draft',
            agent: 'k-developer',
            prompt_file: 'draft.md',
          },
        ],
      },
      'kiro-cli',
    );

    expect(graph.nodes[1]?.data).not.toHaveProperty('description');
  });

  it.each(['claude', 'fake', 'future-harness'])(
    'shows the harness %s as it is, in the node and its name',
    (harness) => {
      const [draft] = buildGraph(HELLO, harness).nodes.filter(
        (node) => node.type === 'stage',
      );

      expect(draft?.data).toMatchObject({ harness });
      expect(draft?.ariaLabel).toBe(
        `Stage draft, agent k-developer, harness ${harness}`,
      );
    },
  );

  it('names each node for a screen reader', () => {
    const { nodes } = buildGraph(HELLO, 'kiro-cli');

    expect(nodes.map((node) => node.ariaLabel)).toEqual([
      'Intent: Add a greeting to the README',
      'Stage draft, agent k-developer, harness kiro-cli',
      'Stage review, agent k-quality-assurance, harness kiro-cli',
    ]);
  });

  it('names each edge by the nodes it joins, not by their ids', () => {
    const { edges } = buildGraph(HELLO, 'kiro-cli');

    expect(edges.map((edge) => edge.ariaLabel)).toEqual([
      'Run order from intent to stage draft',
      'Run order from stage draft to stage review',
    ]);
  });

  it('joins each node to the next with an edge, in list order', () => {
    const { edges } = buildGraph(HELLO, 'kiro-cli');

    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['intent', 'stage-draft'],
      ['stage-draft', 'stage-review'],
    ]);
  });

  it('runs every edge from a sequence-out port to a sequence-in port', () => {
    const { edges } = buildGraph(HELLO, 'kiro-cli');

    for (const edge of edges) {
      expect(edge.sourceHandle).toBe('sequence-out');
      expect(edge.targetHandle).toBe('sequence-in');
    }
  });

  it('gives each edge an id that is not another edge’s id', () => {
    const ids = buildGraph(HELLO, 'kiro-cli').edges.map((edge) => edge.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every edge at nodes that exist', () => {
    const { nodes, edges } = buildGraph(HELLO, 'kiro-cli');
    const ids = new Set(nodes.map((node) => node.id));

    for (const edge of edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it('stacks the nodes down one centred column with a gap between them', () => {
    const { nodes } = buildGraph(HELLO, 'kiro-cli');

    expect(nodes.map((node) => node.position)).toEqual([
      { x: -NODE_WIDTH.intent / 2, y: 0 },
      { x: -NODE_WIDTH.stage / 2, y: NODE_HEIGHT.intent + NODE_GAP },
      {
        x: -NODE_WIDTH.stage / 2,
        y: NODE_HEIGHT.intent + NODE_HEIGHT.stage + 2 * NODE_GAP,
      },
    ]);
  });

  it('sizes each node by its kind', () => {
    const { nodes } = buildGraph(HELLO, 'kiro-cli');

    expect(nodes.map((node) => [node.width, node.height])).toEqual([
      [NODE_WIDTH.intent, NODE_HEIGHT.intent],
      [NODE_WIDTH.stage, NODE_HEIGHT.stage],
      [NODE_WIDTH.stage, NODE_HEIGHT.stage],
    ]);
  });

  it('draws a workflow with no stages as the intent on its own', () => {
    const { nodes, edges } = buildGraph({ ...HELLO, stages: [] }, 'kiro-cli');

    expect(nodes.map((node) => node.id)).toEqual(['intent']);
    expect(edges).toEqual([]);
  });

  it('does not change the workflow it is given', () => {
    const copy = structuredClone(HELLO);

    buildGraph(HELLO, 'kiro-cli');

    expect(HELLO).toEqual(copy);
  });

  it('gives a stage the same id every time', () => {
    expect(stageNodeId('draft')).toBe('stage-draft');
  });

  it('names a node from the id of its stage when the stage has one', () => {
    const graph = buildGraph(
      {
        ...HELLO,
        stages: [
          { id: 's1', name: 'draft', agent: 'k-developer' },
          { id: 's2', name: 'review', agent: 'k-quality-assurance' },
        ],
      },
      'kiro-cli',
    );

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'intent',
      'stage-s1',
      'stage-s2',
    ]);
    expect(graph.nodes[1]).toMatchObject({ data: { name: 'draft' } });
  });

  it('keeps the nodes and edges apart when two stages share a name', () => {
    const graph = buildGraph(
      {
        ...HELLO,
        stages: [
          { id: 's1', name: 'same', agent: 'k-developer' },
          { id: 's2', name: 'same', agent: 'k-developer' },
        ],
      },
      'kiro-cli',
    );

    const ids = graph.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const edgeIds = graph.edges.map((edge) => edge.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });
});

describe('buildGraph, for stages that share a name', () => {
  const stages = [
    { id: 's1', name: 'review', agent: 'k-developer' },
    { id: 's2', name: 'review', agent: 'k-developer' },
    { id: 's3', name: 'ship', agent: 'k-developer' },
  ];

  it('names each of them with its place in the list', () => {
    const graph = buildGraph(
      { name: 'wf', intent: { outcome: 'x' }, stages },
      'kiro-cli',
    );

    expect(graph.nodes.map((node) => node.ariaLabel)).toEqual([
      'Intent: x',
      'Stage review (1 of 3), agent k-developer, harness kiro-cli',
      'Stage review (2 of 3), agent k-developer, harness kiro-cli',
      'Stage ship, agent k-developer, harness kiro-cli',
    ]);
  });
});

it('puts a stage problem in graph data and the accessible label', () => {
  const problem = 'The reference {plan.missing} names no output.';
  const graph = buildGraph(
    {
      name: 'broken',
      intent: { outcome: 'Fix it.' },
      stages: [
        {
          name: 'plan',
          agent: 'k-architect',
          problems: [problem],
        },
      ],
    },
    'kiro-cli',
  );
  expect(graph.nodes[1]).toMatchObject({
    ariaLabel: expect.stringContaining(problem),
    data: { problem, problemCount: 1 },
  });
});

it('bounds a high-count stage problem summary', () => {
  const problems = Array.from(
    { length: 1_000 },
    (_, index) => `Reference ${index} names no output.`,
  );
  const graph = buildGraph(
    {
      name: 'broken',
      intent: { outcome: 'Fix it.' },
      stages: [{ name: 'plan', agent: 'k-architect', problems }],
    },
    'kiro-cli',
  );
  expect(graph.nodes[1]).toMatchObject({
    ariaLabel: expect.stringContaining(
      'Reference 0 names no output. 999 more.',
    ),
    data: {
      problem: 'Reference 0 names no output. 999 more.',
      problemCount: 1_000,
    },
  });
  expect(graph.nodes[1]!.ariaLabel.length).toBeLessThan(150);
});
