// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  itemTextOf,
  stageRefusal,
  writerKeepsItem,
  writerKeepsStage,
} from './stage-item';

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
      '  - name: draft\n    agent: k-developer\n',
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

  // The break that ends a line is part of the bytes of it: a save that ends
  // that line another way has changed the file.
  it.each([
    ['carriage returns and line feeds', '\r\n'],
    ['carriage returns alone', '\r'],
    ['line feeds', '\n'],
  ])('keeps the break of each line it takes, with %s', (_, eol) => {
    const text = `stages:${eol}  - name: draft${eol}    agent: k-developer${eol}`;

    expect(itemTextOf(text, stage(2, 3))).toBe(
      `  - name: draft${eol}    agent: k-developer${eol}`,
    );
  });

  it('takes no break for the last line of a file that ends without one', () => {
    const text = 'stages:\n  - name: draft\n    agent: k-developer';

    expect(itemTextOf(text, stage(2, 3))).toBe(
      '  - name: draft\n    agent: k-developer',
    );
  });
});

describe('writerKeepsItem', () => {
  // The items below are written with line feeds, so the break of the key
  // they are read against is one too, and the last line brings its own.
  const kept = (item: string) =>
    writerKeepsItem(`${item}\n`, 'draft', 'k-developer', '\n');

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
    expect(writerKeepsItem(undefined, 'draft', 'k-developer', '\n')).toBe(
      false,
    );
  });

  // The writer writes a value the way a parser reads back as that same text,
  // so a word YAML 1.1 takes for a boolean comes back quoted.
  it('does not keep an item whose name the file writes as a plain yes', () => {
    const item = '  - name: yes\n    agent: k-developer\n';

    expect(writerKeepsItem(item, 'yes', 'k-developer', '\n')).toBe(false);
  });

  it('does not keep an item whose agent the file writes as a plain off', () => {
    const item = '  - name: draft\n    agent: off\n';

    expect(writerKeepsItem(item, 'draft', 'off', '\n')).toBe(false);
  });

  it('keeps an item whose values the file writes as the writer would', () => {
    const item = '  - name: "yes"\n    agent: "off"\n';

    expect(writerKeepsItem(item, 'yes', 'off', '\n')).toBe(true);
  });

  it.each([
    ['carriage returns and line feeds', '\r\n'],
    ['carriage returns alone', '\r'],
  ])('keeps an item ended the way the key is, with %s', (_, eol) => {
    const item = `  - name: draft${eol}    agent: k-developer${eol}`;

    expect(writerKeepsItem(item, 'draft', 'k-developer', eol)).toBe(true);
  });

  // The writer ends both lines it writes with the break of the `stages:`
  // key, so an item ended any other way is written with other bytes.
  it.each([
    [
      'its lines end another way than the key',
      '  - name: draft\n    agent: k-developer\n',
      '\r\n',
    ],
    [
      'its first line alone ends another way',
      '  - name: draft\r\n    agent: k-developer\n',
      '\n',
    ],
    [
      'its last line alone ends another way',
      '  - name: draft\n    agent: k-developer\r\n',
      '\n',
    ],
    [
      'it ends with no break, as the last line of a file can',
      '  - name: draft\n    agent: k-developer',
      '\n',
    ],
  ])('does not keep an item where %s', (_, item, eol) => {
    expect(writerKeepsItem(item, 'draft', 'k-developer', eol)).toBe(false);
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

  it.each([
    ['carriage returns and line feeds', '\r\n'],
    ['carriage returns alone', '\r'],
    ['line feeds', '\n'],
  ])('keeps a stage of a file written throughout with %s', (_, eol) => {
    const text = `stages:${eol}  - name: draft${eol}    agent: k-developer${eol}`;

    expect(writerKeepsStage(text, [at(2, 3)], 0)).toBe(true);
  });

  it.each([
    [
      'the stage ends its lines another way than the key',
      'stages:\r\n  - name: draft\n    agent: k-developer\n',
    ],
    [
      'the key ends its line another way than the stage',
      'stages:\n  - name: draft\r\n    agent: k-developer\r\n',
    ],
    [
      'the stage ends its lines with a lone carriage return',
      'stages:\n  - name: draft\r    agent: k-developer\r',
    ],
    [
      'the file ends inside the stage with no break',
      'stages:\n  - name: draft\n    agent: k-developer',
    ],
  ])('does not keep a stage where %s', (_, text) => {
    expect(writerKeepsStage(text, [at(2, 3)], 0)).toBe(false);
  });

  it('keeps no stage of a file with no stages key to read a break from', () => {
    const text = 'steps:\n  - name: draft\n    agent: k-developer\n';

    expect(writerKeepsStage(text, [at(2, 3)], 0)).toBe(false);
  });
});

describe('stageRefusal', () => {
  const at = (line: number, endLine: number, over = {}) => ({
    name: 'draft',
    agent: 'k-developer',
    range: { line, end_line: endLine },
    ...over,
  });
  const SECOND = at(7, 8, { name: 'review', agent: 'k-quality-assurance' });

  it('says nothing of a stage the writer would keep', () => {
    expect(stageRefusal(FILE, [at(5, 6), SECOND], 0)).toBeUndefined();
    expect(stageRefusal(FILE, [at(5, 6), SECOND], 1)).toBeUndefined();
  });

  it.each([
    [
      'a comment inside the stage',
      'stages:\n  - name: draft\n    # Writes it.\n    agent: k-developer\n',
      [at(2, 4)],
      0,
      'a comment, a blank line or another key inside it',
    ],
    [
      'another key inside the stage',
      'stages:\n  - name: draft\n    agent: k-developer\n    prompt: Plan it.\n',
      [at(2, 4)],
      0,
      'a comment, a blank line or another key inside it',
    ],
    [
      'a comment in front of a later stage',
      'stages:\n  - name: draft\n    agent: k-developer\n  # Checks it.\n  - name: review\n    agent: k-quality-assurance\n',
      [at(2, 3), at(5, 6, { name: 'review', agent: 'k-quality-assurance' })],
      1,
      'a comment or a blank line in front of it',
    ],
    [
      'a blank line in front of a later stage',
      'stages:\n  - name: draft\n    agent: k-developer\n\n  - name: review\n    agent: k-quality-assurance\n',
      [at(2, 3), at(5, 6, { name: 'review', agent: 'k-quality-assurance' })],
      1,
      'a comment or a blank line in front of it',
    ],
    [
      'a quoted value',
      'stages:\n  - name: draft\n    agent: "k-developer"\n',
      [at(2, 3)],
      0,
      'the agent written as agent: "k-developer", not as agent: k-developer',
    ],
    [
      'a quoted name',
      'stages:\n  - name: "draft"\n    agent: k-developer\n',
      [at(2, 3)],
      0,
      'the name written as "draft", not as draft',
    ],
    [
      'the keys in the other order',
      'stages:\n  - agent: k-developer\n    name: draft\n',
      [at(2, 3)],
      0,
      'agent written before name',
    ],
    [
      'line breaks of another kind than the key has',
      'stages:\n  - name: draft\r\n    agent: k-developer\r\n',
      [at(2, 3)],
      0,
      'line breaks that are not the ones of the stages: key',
    ],
    [
      'no line break at the end of the file',
      'stages:\n  - name: draft\n    agent: k-developer',
      [at(2, 3)],
      0,
      'no line break at the end of the file',
    ],
    [
      'a stage with no place in the file',
      FILE,
      [{ name: 'draft' }],
      0,
      'lines this page cannot read',
    ],
    [
      'no stages: key to write under',
      'flow:\n  - name: draft\n    agent: k-developer\n',
      [at(2, 3)],
      0,
      'no stages: key the writer can write under',
    ],
  ])('names %s', (_, text, stages, index, reason) => {
    expect(stageRefusal(text, stages, index)).toBe(reason);
    expect(writerKeepsStage(text, stages, index)).toBe(false);
  });
});
