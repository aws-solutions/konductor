// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { itemTextOf, writerKeepsItem, writerKeepsStage } from './stage-item';

const FILE = `format: konductor/1
name: hello
stages:
  # The first stage.
  - name: draft
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`;

const stage = (line: number, endLine: number) => ({
  name: 'draft',
  range: { line, end_line: endLine },
});

describe('itemTextOf', () => {
  it('takes the lines the range names', () => {
    expect(itemTextOf(FILE, stage(5, 6))).toBe(
      '  - name: draft\n    agent: k-developer',
    );
  });

  it('takes a comment in front of the stage when the range holds it', () => {
    expect(itemTextOf(FILE, stage(4, 6))).toContain('# The first stage.');
  });

  it.each([
    ['no range', { name: 'draft' }],
    ['a range that is not a mapping', { name: 'draft', range: 'lines 5 to 6' }],
    [
      'a line that is not whole',
      { name: 'draft', range: { line: 1.5, end_line: 6 } },
    ],
    ['a line of 0', { name: 'draft', range: { line: 0, end_line: 6 } }],
    [
      'a range that ends before it starts',
      { name: 'draft', range: { line: 6, end_line: 5 } },
    ],
    [
      'a range past the end of the file',
      { name: 'draft', range: { line: 5, end_line: 99 } },
    ],
  ])('takes no lines for %s', (_, one) => {
    expect(itemTextOf(FILE, one)).toBeUndefined();
  });

  it('takes no lines without a stage', () => {
    expect(itemTextOf(FILE, undefined)).toBeUndefined();
  });

  it('reads a file whose lines end with carriage returns', () => {
    const text = 'stages:\r\n  - name: draft\r\n    agent: k-developer\r\n';

    expect(itemTextOf(text, stage(2, 3))).toBe(
      '  - name: draft\n    agent: k-developer',
    );
  });
});

describe('writerKeepsItem', () => {
  const kept = (item: string) => writerKeepsItem(item, 'draft', 'k-developer');

  it('keeps an item that is the two lines the writer writes', () => {
    expect(kept('  - name: draft\n    agent: k-developer')).toBe(true);
  });

  it('keeps an item written at another indent, as its own lines say', () => {
    expect(kept('- name: draft\n  agent: k-developer')).toBe(true);
  });

  it.each([
    [
      'a comment inside it',
      '  - name: draft\n    # Writes it.\n    agent: k-developer',
    ],
    [
      'a comment at the end of a line',
      '  - name: draft # first\n    agent: k-developer',
    ],
    ['a blank line inside it', '  - name: draft\n\n    agent: k-developer'],
    [
      'another key',
      '  - name: draft\n    agent: k-developer\n    prompt: Write it.',
    ],
    ['a quoted name', '  - name: "draft"\n    agent: k-developer'],
    ['a quoted agent', "  - name: draft\n    agent: 'k-developer'"],
    ['the keys the other way round', '  - agent: k-developer\n    name: draft'],
    [
      'the agent at another indent',
      '  - name: draft\n      agent: k-developer',
    ],
    [
      'the name on a line of its own',
      '  - name:\n      draft\n    agent: k-developer',
    ],
    ['one line only', '  - name: draft'],
    ['a flow mapping', '  - { name: draft, agent: k-developer }'],
  ])('does not keep an item with %s', (_, item) => {
    expect(kept(item)).toBe(false);
  });

  it('does not keep an item whose values are not the ones the file holds', () => {
    expect(kept('  - name: drafting\n    agent: k-developer')).toBe(false);
    expect(kept('  - name: draft\n    agent: k-architect')).toBe(false);
  });

  it('keeps no item whose lines could not be read', () => {
    expect(writerKeepsItem(undefined, 'draft', 'k-developer')).toBe(false);
  });
});

describe('writerKeepsStage', () => {
  const at = (line: number, endLine: number, over = {}) => ({
    name: 'draft',
    agent: 'k-developer',
    range: { line, end_line: endLine },
    ...over,
  });

  // The sample file above: the first stage is at lines 5 and 6, with a
  // comment of its own on line 4, and the second at lines 7 and 8.
  const FIRST = at(5, 6);
  const SECOND = at(7, 8, { name: 'review', agent: 'k-quality-assurance' });

  it('keeps a stage written as the two lines the writer writes', () => {
    expect(writerKeepsStage(FILE, [FIRST, SECOND], 0)).toBe(true);
  });

  it('keeps the first stage though a comment stands in front of it', () => {
    // The lines in front of the first stage are the head of the list, which
    // the writer keeps whatever it does with the stages.
    expect(writerKeepsStage(FILE, [FIRST, SECOND], 0)).toBe(true);
  });

  it('keeps a later stage that follows the one before it line by line', () => {
    expect(writerKeepsStage(FILE, [FIRST, SECOND], 1)).toBe(true);
  });

  it('does not keep a later stage with a comment in front of it', () => {
    const text = `stages:
  - name: draft
    agent: k-developer
  # Checks the greeting.
  - name: review
    agent: k-quality-assurance
`;
    const stages = [
      at(2, 3),
      at(5, 6, { name: 'review', agent: 'k-quality-assurance' }),
    ];

    // The writer reads that comment as part of the stage that follows it.
    expect(writerKeepsStage(text, stages, 1)).toBe(false);
    expect(writerKeepsStage(text, stages, 0)).toBe(true);
  });

  it('does not keep a later stage with a blank line in front of it', () => {
    const text =
      'stages:\n  - name: draft\n    agent: k-developer\n\n  - name: review\n    agent: k-quality-assurance\n';
    const stages = [
      at(2, 3),
      at(5, 6, { name: 'review', agent: 'k-quality-assurance' }),
    ];

    expect(writerKeepsStage(text, stages, 1)).toBe(false);
  });

  it('does not keep a stage with a comment inside it', () => {
    const text = `stages:
  - name: draft
    # Writes the greeting.
    agent: k-developer
`;

    expect(writerKeepsStage(text, [at(2, 4)], 0)).toBe(false);
  });

  it('keeps no stage the file view does not have', () => {
    expect(writerKeepsStage(FILE, [FIRST], 1)).toBe(false);
  });

  it('keeps no stage whose place in the file cannot be read', () => {
    expect(writerKeepsStage(FILE, [{ name: 'draft' }], 0)).toBe(false);
  });

  it('keeps no later stage when the one before it has no place', () => {
    expect(writerKeepsStage(FILE, [{ name: 'draft' }, SECOND], 1)).toBe(false);
  });
});
