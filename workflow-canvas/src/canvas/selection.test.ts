// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../graph';
import { markSelectable } from './selection';

const GRAPH = buildGraph(
  {
    name: 'hello',
    intent: { outcome: 'Say hi' },
    stages: [
      { id: 's1', name: 'draft', agent: 'k-developer' },
      { id: 's2', name: 'review', agent: 'k-tpm' },
    ],
  },
  'kiro-cli',
);

describe('markSelectable', () => {
  const nodes = markSelectable(GRAPH.nodes, 'stage-s2');

  it('lets only the stages be selected', () => {
    expect(nodes.map((node) => node.selectable)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('marks the node with the id as selected, and no other', () => {
    expect(nodes.map((node) => node.selected)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('says selected in the name of the selected node for a screen reader', () => {
    expect(nodes[2]?.ariaLabel).toBe(
      'Stage review, agent k-tpm, harness kiro-cli, selected',
    );
    expect(nodes[1]?.ariaLabel).toBe(
      'Stage draft, agent k-developer, harness kiro-cli',
    );
  });

  it('selects nothing when no id is given', () => {
    expect(
      markSelectable(GRAPH.nodes, undefined).some((node) => node.selected),
    ).toBe(false);
  });

  it('does not change the graph it is given', () => {
    expect(GRAPH.nodes.some((node) => 'selected' in node)).toBe(false);
  });
});
