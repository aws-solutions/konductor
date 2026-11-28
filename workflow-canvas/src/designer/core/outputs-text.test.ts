// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  OUTPUT_COMMENTS_REASON,
  OUTPUT_DUPLICATE_ERROR,
  outputEditBlocker,
  outputNameError,
  withOutputs,
} from './outputs-text';

const head = (eol = '\n') =>
  [
    'format: konductor/1',
    'name: hello',
    'version: 0.1.0',
    'intent:',
    '  outcome: Do it.',
    'stages:',
  ].join(eol) + eol;

const stage = (body: string, eol = '\n') =>
  `${head(eol)}  - name: plan${eol}    agent: k-architect${eol}${body}`;

const write = (
  text: string,
  outputs: readonly { readonly name: string; readonly path: string }[],
  before: Readonly<Record<string, string>> = { design: 'DESIGN.md' },
) => withOutputs(text, [{ outputs, before }]);

function value(written: ReturnType<typeof write>): string {
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error(written.reason);
  return written.text;
}

const design = { name: 'design', path: 'DESIGN.md' };
const more = { name: 'more', path: 'MORE.md' };

describe('withOutputs scalar edits', () => {
  it.each([
    ['LF', stage('    outputs:\n      design: DESIGN.md\n')],
    ['CRLF', stage('    outputs:\r\n      design: DESIGN.md\r\n', '\r\n')],
    ['BOM', `\uFEFF${stage('    outputs:\n      design: DESIGN.md\n')}`],
    ['no final newline', stage('    outputs:\n      design: DESIGN.md')],
  ])('changes only the value bytes with %s', (_, text) => {
    const written = value(
      write(text, [{ name: 'design', path: 'docs/DESIGN.md' }]),
    );
    expect(written.replace('docs/DESIGN.md', 'DESIGN.md')).toBe(text);
  });

  it.each(['null', 'true', 'false'])(
    'quotes the contract-valid YAML-shaped name %s',
    (name) => {
      const text = stage('    outputs: {design: DESIGN.md}\n');
      const written = value(write(text, [{ name, path: 'VALUE.md' }]));
      expect(written).toContain(`outputs: {${JSON.stringify(name)}: VALUE.md}`);
      expect(Object.keys(parse(written).stages[0].outputs)).toEqual([name]);
    },
  );
});

describe('withOutputs structural edits preserve surviving bytes', () => {
  it.each([
    {
      name: 'block add with quoted source',
      text: stage('    outputs:\n      "design" : "DESIGN.md"\n'),
      outputs: [design, more],
      before: { design: 'DESIGN.md' },
      expected: stage(
        '    outputs:\n      "design" : "DESIGN.md"\n      more: MORE.md\n',
      ),
    },
    {
      name: 'block remove first row',
      text: stage(
        '    outputs:\n      "design" : "DESIGN.md"\n      more: "MORE.md"\n',
      ),
      outputs: [more],
      before: { design: 'DESIGN.md', more: 'MORE.md' },
      expected: stage('    outputs:\n      more: "MORE.md"\n'),
    },
    {
      name: 'block remove last row without final newline',
      text: stage(
        '    outputs:\n      "design" : "DESIGN.md"\n      more: "MORE.md"',
      ),
      outputs: [design],
      before: { design: 'DESIGN.md', more: 'MORE.md' },
      expected: stage('    outputs:\n      "design" : "DESIGN.md"'),
    },
    {
      name: 'flow add with custom spacing',
      text: stage('    outputs: { "design" : "DESIGN.md" }\n'),
      outputs: [design, more],
      before: { design: 'DESIGN.md' },
      expected: stage(
        '    outputs: { "design" : "DESIGN.md", more: MORE.md }\n',
      ),
    },
    {
      name: 'flow remove first row',
      text: stage(
        '    outputs: { "design" : "DESIGN.md", more : "MORE.md" }\n',
      ),
      outputs: [more],
      before: { design: 'DESIGN.md', more: 'MORE.md' },
      expected: stage('    outputs: { more : "MORE.md" }\n'),
    },
    {
      name: 'flow remove last row',
      text: stage(
        '    outputs: { "design" : "DESIGN.md", more : "MORE.md" }\n',
      ),
      outputs: [design],
      before: { design: 'DESIGN.md', more: 'MORE.md' },
      expected: stage('    outputs: { "design" : "DESIGN.md" }\n'),
    },
    {
      name: 'empty flow mapping',
      text: stage('    outputs: { }\n'),
      outputs: [more],
      before: {},
      expected: stage('    outputs: { more: MORE.md}\n'),
    },
    {
      name: 'absent outputs at EOF without final newline',
      text: stage('').slice(0, -1),
      outputs: [more],
      before: {},
      expected: `${stage('').slice(0, -1)}\n    outputs:\n      more: MORE.md`,
    },
    {
      name: 'CRLF block add',
      text: stage('    outputs:\r\n      "design": "DESIGN.md"\r\n', '\r\n'),
      outputs: [design, more],
      before: { design: 'DESIGN.md' },
      expected: stage(
        '    outputs:\r\n      "design": "DESIGN.md"\r\n      more: MORE.md\r\n',
        '\r\n',
      ),
    },
  ])('$name', ({ text, outputs, before, expected }) => {
    expect(
      value(write(text, outputs, before as Readonly<Record<string, string>>)),
    ).toBe(expected);
  });
});

describe('withOutputs refusals', () => {
  it.each(['Bad', '1name', 'two_words', ''])(
    'rejects output name %j',
    (name) => {
      expect(outputNameError(name)).toBeDefined();
      expect(
        write(stage('    outputs: {}\n'), [{ name, path: 'A.md' }], {}),
      ).toEqual(expect.objectContaining({ ok: false }));
    },
  );

  it.each([
    ['block', stage('    outputs:\n      a: A.md\n      b: B.md\n')],
    ['flow', stage('    outputs: {a: A.md, b: B.md}\n')],
  ])('rejects duplicate requested names in %s form', (_, text) => {
    expect(
      write(
        text,
        [
          { name: 'a', path: 'A.md' },
          { name: 'a', path: 'B.md' },
        ],
        { a: 'A.md', b: 'B.md' },
      ),
    ).toEqual({ ok: false, reason: OUTPUT_DUPLICATE_ERROR });
  });

  it.each([
    [
      'comment before a row',
      '    outputs:\n      # keep\n      design: DESIGN.md\n',
    ],
    ['inline comment', '    outputs:\n      design: DESIGN.md # keep\n'],
    ['flow comment', '    outputs: {design: DESIGN.md # keep\n    }\n'],
  ])('reports %s before a structural edit', (_, body) => {
    const text = stage(body);
    expect(outputEditBlocker(text, 0, true)).toBe(OUTPUT_COMMENTS_REASON);
    expect(outputEditBlocker(text, 0, false)).toBeUndefined();
  });

  it.each([
    ['anchor', '    outputs: &saved {design: DESIGN.md}\n'],
    ['tag', '    outputs: !saved {design: DESIGN.md}\n'],
    ['alias', '    other: &saved {design: DESIGN.md}\n    outputs: *saved\n'],
    ['duplicate source key', '    outputs: {design: A.md, design: B.md}\n'],
  ])('refuses source %s with an exact stage reason', (_, body) => {
    expect(outputEditBlocker(stage(body), 0)).toMatch(
      /anchor|alias|tag|duplicate/,
    );
  });
});

describe('output blocker isolation', () => {
  it('does not mistake a quoted # for a comment', () => {
    const text = stage('    outputs:\n      design: "dir/#file.md"\n');
    expect(outputEditBlocker(text, 0, true)).toBeUndefined();
    expect(
      value(
        write(text, [{ name: 'design', path: 'dir/#file.md' }, more], {
          design: 'dir/#file.md',
        }),
      ),
    ).toBe(
      stage(
        '    outputs:\n      design: "dir/#file.md"\n      more: MORE.md\n',
      ),
    );
  });

  it('edits a safe stage beside a refused stage', () => {
    const text = `${stage('    outputs: &saved {design: DESIGN.md}\n')}  - name: build\n    agent: k-developer\n    outputs: {note: NOTE.md}\n`;
    const written = withOutputs(text, [
      { outputs: [design], before: { design: 'DESIGN.md' } },
      {
        outputs: [{ name: 'note', path: 'docs/NOTE.md' }],
        before: { note: 'NOTE.md' },
      },
    ]);
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error(written.reason);
    expect(written.text).toBe(
      text.replace('note: NOTE.md', 'note: docs/NOTE.md'),
    );
    expect(outputEditBlocker(text, 0)).toBeDefined();
    expect(outputEditBlocker(text, 1)).toBeUndefined();
  });
});
