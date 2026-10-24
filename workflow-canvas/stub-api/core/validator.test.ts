// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/** Checks the rules of the workflow check, one problem per case. */
import { describe, expect, it } from 'vitest';
import { SAMPLE_FILES, SAMPLE_ROOT } from './sample.ts';
import { suggestKey } from './suggest.ts';
import { checkWorkflowText } from './validator.ts';

const VALID = SAMPLE_FILES[SAMPLE_ROOT] ?? '';
const HEAD = 'name: hello\nintent: Say hello\n';
const STAGES = 'stages:\n  - name: write\n    agent: k-developer\n';

type Where = [code: string, path: string, line: number, column: number];
type Span = [...Where, endLine: number, endColumn: number];

function codesOf(text: string): Where[] {
  return checkWorkflowText(text, 'hello').diagnostics.map((d) => [
    d.code,
    d.path,
    d.line,
    d.column,
  ]);
}

function spansOf(text: string): Span[] {
  return checkWorkflowText(text, 'hello').diagnostics.map((d) => [
    d.code,
    d.path,
    d.line,
    d.column,
    d.end_line,
    d.end_column,
  ]);
}

describe('a valid workflow', () => {
  it('has no diagnostics and a view with the intent as a mapping', () => {
    expect(checkWorkflowText(VALID, 'hello')).toEqual({
      errors: 0,
      warnings: 0,
      infos: 0,
      diagnostics: [],
      summary: { valid: true, counts: { stages: 2 } },
      view: {
        name: 'hello',
        intent: { outcome: 'Add a greeting to the README' },
        stages: [
          { name: 'draft', agent: 'k-developer' },
          { name: 'review', agent: 'k-quality-assurance' },
        ],
      },
    });
  });

  it('may leave out name and may give the intent as a mapping', () => {
    const text = `version: '1.1'\nintent:\n  outcome: Say hello\n${STAGES}`;
    expect(checkWorkflowText(text, 'hello').view).toEqual({
      name: 'hello',
      intent: { outcome: 'Say hello' },
      stages: [{ name: 'write', agent: 'k-developer' }],
    });
  });

  it('reads a byte order mark and CRLF line ends', () => {
    expect(
      codesOf(`\uFEFF${(HEAD + STAGES).replaceAll('\n', '\r\n')}`),
    ).toEqual([]);
  });

  it('treats on, yes and no as plain strings', () => {
    const text = `${HEAD}stages:\n  - name: yes\n    agent: no\n`;
    expect(codesOf(text)).toEqual([]);
  });
});

describe('the whole text', () => {
  it.each([
    ['empty', ''],
    ['blank lines', '\n\n  \n'],
    ['only a comment', '# nothing here\n'],
  ])('is not a mapping when %s, at line 1 column 1', (_, text) => {
    expect(spansOf(text)).toEqual([['NOT_A_MAPPING', '', 1, 1, 1, 1]]);
  });

  it('is not a mapping when it is a scalar or a list', () => {
    expect(spansOf('hello\n')).toEqual([['NOT_A_MAPPING', '', 1, 1, 1, 6]]);
    expect(codesOf('- a\n- b\n')).toEqual([['NOT_A_MAPPING', '', 1, 1]]);
  });

  it('reports a syntax error where the parser found it, with no width', () => {
    const [found, ...rest] = spansOf('name: hello\nintent: [oops\n');
    expect(rest).toEqual([]);
    expect(found?.slice(0, 2)).toEqual(['YAML_SYNTAX', '']);
    expect(found?.[4]).toBe(found?.[2]);
    expect(found?.[5]).toBe(found?.[3]);
  });

  it.each([
    ['an anchor', `${HEAD}x: &a 1\n${STAGES}`, 'x', 3],
    ['a * reference', `${HEAD}x: *a\n${STAGES}`, 'x', 3],
    ['a tag', `name: hello\nintent: !!str Say hello\n${STAGES}`, 'intent', 2],
    ['a merge key', `${HEAD}<<: {a: 1}\n${STAGES}`, '', 3],
    ['a key that is a list', `${HEAD}? [a]\n: b\n${STAGES}`, '', 3],
  ])('does not allow %s', (_, text, path, line) => {
    const [found, ...rest] = codesOf(text);
    expect(rest).toEqual([]);
    expect(found?.slice(0, 3)).toEqual(['YAML_UNSUPPORTED', path, line]);
  });

  it('does not allow a second document', () => {
    expect(codesOf(`${HEAD + STAGES}---\na: 1\n`).map((d) => d[0])).toEqual([
      'YAML_UNSUPPORTED',
    ]);
  });
});

describe('keys', () => {
  it('reports an unknown key, with a suggestion only when one is near', () => {
    const near = checkWorkflowText(`name: hello\nintnt: x\n${STAGES}`, 'hello');
    expect(near.diagnostics.map((d) => [d.code, d.suggestion])).toEqual([
      ['MISSING_KEY', undefined],
      ['UNKNOWN_KEY', 'intent'],
    ]);
    const far = checkWorkflowText(`${HEAD}owner: me\n${STAGES}`, 'hello');
    expect(far.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_KEY' });
    expect(far.diagnostics[0]).not.toHaveProperty('suggestion');
  });

  it('breaks a tie between suggestions with the first candidate', () => {
    expect(suggestKey('xame', ['name', 'came'])).toBe('name');
    expect(suggestKey('xame', ['came', 'name'])).toBe('came');
    expect(suggestKey('abcdef', ['name'])).toBeUndefined();
  });

  it('suggests a stage key', () => {
    const text = `${HEAD}stages:\n  - nme: write\n    agent: k-developer\n`;
    const [unknown] = checkWorkflowText(text, 'hello').diagnostics;
    expect(unknown).toMatchObject({
      code: 'UNKNOWN_KEY',
      path: 'stages[0].nme',
      suggestion: 'name',
    });
  });

  it('reports the later of two equal keys as DUPLICATE_KEY', () => {
    const text = `${HEAD}intent: Another\n${STAGES}`;
    expect(spansOf(text)).toEqual([['DUPLICATE_KEY', 'intent', 3, 1, 3, 7]]);
  });

  it('reports an unknown key once as unknown and then as duplicates', () => {
    const text = `${HEAD}owner: me\nowner: you\nowner: it\n${STAGES}`;
    expect(codesOf(text)).toEqual([
      ['UNKNOWN_KEY', 'owner', 3, 1],
      ['DUPLICATE_KEY', 'owner', 4, 1],
      ['DUPLICATE_KEY', 'owner', 5, 1],
    ]);
  });

  it('compares keys by their text, before they are read as numbers', () => {
    const text = `${HEAD}1: a\n'1': b\n1.0: c\n0x1: d\ntrue: e\nTrue: f\n${STAGES}`;
    expect(codesOf(text)).toEqual([
      ['UNKNOWN_KEY', '1', 3, 1],
      ['DUPLICATE_KEY', '1', 4, 1],
      ['UNKNOWN_KEY', '1.0', 5, 1],
      ['UNKNOWN_KEY', '0x1', 6, 1],
      ['UNKNOWN_KEY', 'true', 7, 1],
      ['UNKNOWN_KEY', 'True', 8, 1],
    ]);
  });

  it('reports a missing key at the mapping that lacks it', () => {
    expect(spansOf('name: hello\n')).toEqual([
      ['MISSING_KEY', '', 1, 1, 2, 1],
      ['MISSING_KEY', '', 1, 1, 2, 1],
    ]);
    expect(codesOf(`name: hello\nintent: {}\n${STAGES}`)).toEqual([
      ['MISSING_KEY', 'intent', 2, 9],
    ]);
  });

  it('addresses a stage by its name, or by its place if it has none', () => {
    const noAgent = `${HEAD}stages:\n  - name: write\n`;
    expect(codesOf(noAgent)).toEqual([['MISSING_KEY', 'stages.write', 4, 5]]);
    const noName = `${HEAD}stages:\n  - agent: k-developer\n`;
    expect(codesOf(noName)).toEqual([['MISSING_KEY', 'stages[0]', 4, 5]]);
  });
});

describe('values', () => {
  it.each([
    ['version: 1.1\n' + HEAD + STAGES, 'version', 1],
    ['name: 123\nintent: x\n' + STAGES, 'name', 1],
    ['name: true\nintent: x\n' + STAGES, 'name', 1],
    [HEAD.replace('Say hello', '[a]') + STAGES, 'intent', 2],
    [`${HEAD}stages: write\n`, 'stages', 3],
    [
      `${HEAD}stages:\n  - name: write\n    agent: 5\n`,
      'stages.write.agent',
      5,
    ],
    [
      `${HEAD}stages:\n  - name:\n    agent: k-developer\n`,
      'stages[0].name',
      4,
    ],
  ])('is WRONG_TYPE for a value of another kind (%#)', (text, path, line) => {
    const found = codesOf(text).find((d) => d[0] === 'WRONG_TYPE');
    expect(found?.slice(1, 3)).toEqual([path, line]);
  });

  it('is NOT_A_MAPPING for a stage that is not a mapping', () => {
    expect(codesOf(`${HEAD}stages:\n  - write\n`)).toEqual([
      ['NOT_A_MAPPING', 'stages[0]', 4, 5],
    ]);
  });

  it('is INVALID_NAME for a string that is not a name', () => {
    const text = `${HEAD}stages:\n  - name: Write\n    agent: k_developer\n`;
    expect(codesOf(text)).toEqual([
      ['INVALID_NAME', 'stages[0].name', 4, 11],
      ['INVALID_NAME', 'stages[0].agent', 5, 12],
    ]);
  });

  it('is RESERVED_NAME for start, end, run and halt', () => {
    const text = `${HEAD}stages:\n  - name: end\n    agent: k-developer\n`;
    expect(codesOf(text)).toEqual([['RESERVED_NAME', 'stages[0].name', 4, 11]]);
  });

  it('is DUPLICATE_STAGE for the later of two equal stage names', () => {
    const text = `${STAGES}  - name: write\n    agent: k-developer\n`;
    expect(spansOf(HEAD + text)).toEqual([
      ['DUPLICATE_STAGE', 'stages[1].name', 6, 11, 6, 16],
    ]);
  });

  it('is NAME_MISMATCH when name is not the name of the file', () => {
    expect(codesOf(`name: other\nintent: x\n${STAGES}`)).toEqual([
      ['NAME_MISMATCH', 'name', 1, 7],
    ]);
  });

  it.each([
    ["version: '2'\n" + HEAD + STAGES, 'version'],
    ["name: hello\nintent: ''\n" + STAGES, 'intent'],
    ['name: hello\nintent: |\n  one\n  two\n' + STAGES, 'intent'],
    [`name: hello\nintent: ${'x'.repeat(301)}\n${STAGES}`, 'intent'],
    [`name: hello\nintent:\n  outcome: ''\n${STAGES}`, 'intent.outcome'],
    [`${HEAD}stages: []\n`, 'stages'],
    [
      HEAD +
        'stages:\n' +
        Array.from(
          { length: 41 },
          (_, i) => `  - name: s${i}\n    agent: a\n`,
        ).join(''),
      'stages',
    ],
  ])('is INVALID_VALUE for a value out of range (%#)', (text, path) => {
    expect(codesOf(text).map((d) => d.slice(0, 2))).toEqual([
      ['INVALID_VALUE', path],
    ]);
  });

  it('accepts an intent of 300 characters, counting code points', () => {
    const text = `name: hello\nintent: "${'😀'.repeat(300)}"\n${STAGES}`;
    expect(codesOf(text)).toEqual([]);
  });
});

describe('positions', () => {
  it('count code points, not UTF-16 units', () => {
    const text = `name: "😀😀"\nintent: x\n${STAGES}`;
    expect(spansOf(text)).toEqual([['INVALID_NAME', 'name', 1, 7, 1, 11]]);
  });

  it('count a tab as one column', () => {
    const text = `name:\tHello\nintent: x\n${STAGES}`;
    expect(codesOf(text)).toEqual([['INVALID_NAME', 'name', 1, 7]]);
  });

  it('end a line at a lone CR or at CRLF as well as at LF', () => {
    const lone = `name: hello\rintent: x\rowner: 1\r${STAGES.replaceAll('\n', '\r')}`;
    expect(codesOf(lone)).toEqual([['UNKNOWN_KEY', 'owner', 3, 1]]);
    const crlf = `name: hello\r\nintent: x\r\nowner: 1\r\n${STAGES}`;
    expect(codesOf(crlf)).toEqual([['UNKNOWN_KEY', 'owner', 3, 1]]);
  });
});
