// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  sourceRowPatches,
  type SourceRow,
  type SourceRows,
} from './source-rows';
import { afterLine, applyPatches, lineStart } from './yaml-source';

function rowOf(text: string, key: string, value: string): SourceRow {
  const start = text.indexOf(key);
  const contentEnd = text.indexOf(value, start) + value.length;
  return {
    start,
    contentEnd,
    lineStart: lineStart(text, start),
    lineEnd: afterLine(text, contentEnd),
  };
}

function replaceRows({
  text,
  source,
  rows,
}: {
  text: string;
  source: SourceRows;
  rows: readonly string[];
}) {
  const patches = sourceRowPatches({
    text,
    source,
    matches: [],
    currentCount: rows.length,
    render: (index) => rows[index]!,
    commentReason: 'comments',
  });
  expect(patches).not.toBe('comments');
  return applyPatches(text, typeof patches === 'string' ? [] : patches);
}

describe('sourceRowPatches replacing every row', () => {
  it.each([
    {
      name: 'one LF row',
      text: 'outputs:\n  a: A.md\n',
      before: [['a', 'A.md']] as const,
      rows: ['c: C.md'],
      expected: 'outputs:\n  c: C.md\n',
    },
    {
      name: 'many CRLF rows with a BOM',
      text: '\uFEFFoutputs:\r\n  a: A.md\r\n  b: B.md\r\n',
      before: [
        ['a', 'A.md'],
        ['b', 'B.md'],
      ] as const,
      rows: ['c: C.md', 'd: D.md'],
      expected: '\uFEFFoutputs:\r\n  c: C.md\r\n  d: D.md\r\n',
    },
    {
      name: 'one row without a final newline',
      text: 'outputs:\n  a: A.md',
      before: [['a', 'A.md']] as const,
      rows: ['c: C.md'],
      expected: 'outputs:\n  c: C.md',
    },
  ])(
    'renders valid block YAML for $name',
    ({ text, before, rows, expected }) => {
      const source: SourceRows = {
        flow: false,
        close: text.length,
        indent: '  ',
        rows: before.map(([key, value]) => rowOf(text, key, value)),
        hasComments: false,
      };
      expect(replaceRows({ text, source, rows })).toBe(expected);
    },
  );

  it.each([
    [
      'one row',
      'outputs: {a: A.md}',
      [['a', 'A.md']] as const,
      ['c: C.md'],
      'outputs: {c: C.md}',
    ],
    [
      'many rows',
      'outputs: {a: A.md, b: B.md}',
      [
        ['a', 'A.md'],
        ['b', 'B.md'],
      ] as const,
      ['c: C.md', 'd: D.md'],
      'outputs: {c: C.md, d: D.md}',
    ],
  ])('renders valid flow YAML for %s', (_, text, before, rows, expected) => {
    const source: SourceRows = {
      flow: true,
      close: text.indexOf('}'),
      indent: '',
      rows: before.map(([key, value]) => rowOf(text, key, value)),
      hasComments: false,
    };
    expect(replaceRows({ text, source, rows })).toBe(expected);
  });

  it('refuses replacement when comments make it structural', () => {
    const text = 'outputs:\n  a: A.md # keep\n';
    expect(
      sourceRowPatches({
        text,
        source: {
          flow: false,
          close: text.length,
          indent: '  ',
          rows: [rowOf(text, 'a', 'A.md')],
          hasComments: true,
        },
        matches: [],
        currentCount: 1,
        render: () => 'c: C.md',
        commentReason: 'comments',
      }),
    ).toBe('comments');
  });
});
