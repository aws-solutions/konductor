// SPDX-License-Identifier: Apache-2.0
/** Checks the rules of the workflow check, one problem per case. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAMPLE_FILES, SAMPLE_ROOT } from './sample.ts';
import { suggestKey } from './suggest.ts';
import { checkWorkflowText } from './validator.ts';

const VALID = SAMPLE_FILES[SAMPLE_ROOT] ?? '';
const FORMAT = 'format: konductor/1\n';
const NAME = 'name: hello\n';
const VERSION = 'version: 0.1.0\n';
const INTENT = 'intent:\n  outcome: Say hello\n';
// Five lines, so the stages start on line 6.
const HEAD = FORMAT + NAME + VERSION + INTENT;
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

// A stage with the given extra lines, each indented to sit inside it.
function stageWith(...lines: string[]): string {
  return `${HEAD}stages:\n  - name: write\n    agent: k-developer\n${lines
    .map((line) => `    ${line}\n`)
    .join('')}`;
}

describe('a valid workflow', () => {
  it('has no diagnostics and a view with the keys of the file', () => {
    expect(checkWorkflowText(VALID, 'hello')).toEqual({
      errors: 0,
      warnings: 0,
      infos: 0,
      diagnostics: [],
      summary: { valid: true, counts: { stages: 2 } },
      view: {
        format: 'konductor/1',
        version: '0.1.0',
        name: 'hello',
        intent: {
          outcome: 'Add a greeting to the README',
          accept: [{ id: 'readme-exists', file: 'README.md' }],
        },
        params: {
          goal: {
            description: 'What the workflow should accomplish.',
            default: 'Add a greeting to the README',
          },
        },
        stages: [
          {
            name: 'draft',
            agent: 'k-developer',
            prompt: 'Write the greeting to README.md.',
          },
          {
            name: 'review',
            agent: 'k-quality-assurance',
            prompt_file: 'review.md',
          },
        ],
      },
    });
  });

  it('may leave out name, params and accept', () => {
    const text = FORMAT + VERSION + INTENT + STAGES;
    expect(checkWorkflowText(text, 'hello').view).toEqual({
      format: 'konductor/1',
      version: '0.1.0',
      name: 'hello',
      intent: { outcome: 'Say hello' },
      stages: [{ name: 'write', agent: 'k-developer' }],
    });
  });

  it('keeps an empty accept list and an empty params mapping', () => {
    const text = `${FORMAT}${VERSION}intent:\n  outcome: x\n  accept: []\nparams: {}\n${STAGES}`;
    const { view } = checkWorkflowText(text, 'hello');
    expect(view?.intent).toEqual({ outcome: 'x', accept: [] });
    expect(view?.params).toEqual({});
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

  it('accepts a brace in a prompt that is not a reference', () => {
    const text = stageWith(
      'prompt: Return {severity, file, line} and the number {1.5}.',
    );
    expect(codesOf(text)).toEqual([]);
  });

  it('accepts a prompt_file without reading it', () => {
    expect(codesOf(stageWith('prompt_file: no-such-file.md'))).toEqual([]);
  });

  it('accepts the hello-plan example of the workflow engine', () => {
    const example = new URL(
      '../../../workflow-engine/examples/hello-plan.yml',
      import.meta.url,
    );
    const check = checkWorkflowText(
      readFileSync(example, 'utf8'),
      'hello-plan',
    );
    expect(check.diagnostics).toEqual([]);
    expect(check.view?.stages.map((stage) => stage.name)).toEqual([
      'plan',
      'implement',
    ]);
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
    ['an anchor', `${HEAD}x: &a 1\n${STAGES}`, 'x', 6],
    ['a * reference', `${HEAD}x: *a\n${STAGES}`, 'x', 6],
    [
      'a tag',
      `${FORMAT}${NAME}${VERSION}intent: !!str x\n${STAGES}`,
      'intent',
      4,
    ],
    ['a merge key', `${HEAD}<<: {a: 1}\n${STAGES}`, '', 6],
    ['a key that is a list', `${HEAD}? [a]\n: b\n${STAGES}`, '', 6],
  ])('does not allow %s', (_, text, path, line) => {
    const [found, ...rest] = codesOf(text);
    expect(rest).toEqual([]);
    expect(found?.slice(0, 3)).toEqual(['YAML_UNSUPPORTED', path, line]);
  });

  it('reports a second document at its --- line, to the end of its content', () => {
    expect(spansOf(`${HEAD + STAGES}---\na: 1\n`)).toEqual([
      ['YAML_UNSUPPORTED', '', 9, 1, 11, 1],
    ]);
  });

  it('reports a second document after an empty first one on line 2', () => {
    expect(spansOf('---\n---\nintent: x\n')).toEqual([
      ['YAML_UNSUPPORTED', '', 2, 1, 4, 1],
    ]);
  });
});

describe('keys', () => {
  it('reports an unknown key, with a suggestion only when one is near', () => {
    const near = checkWorkflowText(
      `${FORMAT}${NAME}${VERSION}intnt: x\n${STAGES}`,
      'hello',
    );
    expect(near.diagnostics.map((d) => [d.code, d.suggestion])).toEqual([
      ['MISSING_KEY', undefined],
      ['UNKNOWN_KEY', 'intent'],
    ]);
    const far = checkWorkflowText(`${HEAD}owner: me\n${STAGES}`, 'hello');
    expect(far.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_KEY' });
    expect(far.diagnostics[0]).not.toHaveProperty('suggestion');
  });

  it('suggests only a key that this version reads', () => {
    const text = `${HEAD}${STAGES}    outputz: x\n    prompt_fil: x.md\n`;
    const found = checkWorkflowText(text, 'hello').diagnostics;
    expect(found.map((d) => [d.code, d.suggestion])).toEqual([
      ['UNKNOWN_KEY', undefined],
      ['UNKNOWN_KEY', 'prompt_file'],
    ]);
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
    expect(spansOf(text)).toEqual([['DUPLICATE_KEY', 'intent', 6, 1, 6, 7]]);
  });

  it('reports a key of a later slice once as unsupported and then as duplicates', () => {
    const text = stageWith('outputs: {}', 'outputs: {}');
    expect(codesOf(text)).toEqual([
      ['NOT_SUPPORTED_BY_THIS_BUILD', 'stages.write.outputs', 9, 5],
      ['DUPLICATE_KEY', 'stages.write.outputs', 10, 5],
    ]);
  });

  it('reports an unknown key once as unknown and then as duplicates', () => {
    const text = `${HEAD}owner: me\nowner: you\nowner: it\n${STAGES}`;
    expect(codesOf(text)).toEqual([
      ['UNKNOWN_KEY', 'owner', 6, 1],
      ['DUPLICATE_KEY', 'owner', 7, 1],
      ['DUPLICATE_KEY', 'owner', 8, 1],
    ]);
  });

  it('compares keys by their text, before they are read as numbers', () => {
    const text = `${HEAD}1: a\n'1': b\n1.0: c\n0x1: d\ntrue: e\nTrue: f\n${STAGES}`;
    expect(codesOf(text)).toEqual([
      ['UNKNOWN_KEY', '1', 6, 1],
      ['DUPLICATE_KEY', '1', 7, 1],
      ['UNKNOWN_KEY', '1.0', 8, 1],
      ['UNKNOWN_KEY', '0x1', 9, 1],
      ['UNKNOWN_KEY', 'true', 10, 1],
      ['UNKNOWN_KEY', 'True', 11, 1],
    ]);
  });

  it('reports a missing key at the mapping that lacks it', () => {
    expect(spansOf('name: hello\n')).toEqual([
      ['MISSING_KEY', '', 1, 1, 2, 1],
      ['MISSING_KEY', '', 1, 1, 2, 1],
      ['MISSING_KEY', '', 1, 1, 2, 1],
      ['MISSING_KEY', '', 1, 1, 2, 1],
    ]);
    expect(codesOf(`${FORMAT}${NAME}${VERSION}intent: {}\n${STAGES}`)).toEqual([
      ['MISSING_KEY', 'intent', 4, 9],
    ]);
  });

  it('suggests format: konductor/1 for a missing format, and nothing for the others', () => {
    const { diagnostics } = checkWorkflowText('name: hello\n', 'hello');
    expect(diagnostics.map((d) => [d.message, d.suggestion])).toEqual([
      ['The mapping needs the key `format`.', 'format: konductor/1'],
      ['The mapping needs the key `version`.', undefined],
      ['The mapping needs the key `intent`.', undefined],
      ['The mapping needs the key `stages`.', undefined],
    ]);
  });

  it('addresses a stage by its name, or by its place if it has none', () => {
    const noName = `${HEAD}stages:\n  - agent: k-developer\n`;
    expect(codesOf(noName)).toEqual([['MISSING_KEY', 'stages[0]', 7, 5]]);
    const noAgent = `${HEAD}stages:\n  - name: write\n`;
    expect(codesOf(noAgent)).toEqual([
      ['STAGE_KIND_MISSING', 'stages.write', 7, 5],
    ]);
  });
});

describe('format', () => {
  it('is UNSUPPORTED_FORMAT for a string other than konductor/1', () => {
    const text = `format: konductor/2\n${NAME}${VERSION}${INTENT}${STAGES}`;
    expect(spansOf(text)).toEqual([
      ['UNSUPPORTED_FORMAT', 'format', 1, 9, 1, 20],
    ]);
  });

  it('is WRONG_TYPE for a value that is not a string', () => {
    const text = `format: 1\n${NAME}${VERSION}${INTENT}${STAGES}`;
    expect(codesOf(text)).toEqual([['WRONG_TYPE', 'format', 1, 9]]);
  });
});

describe('version', () => {
  it.each(['0.1.0', '1.0.0', '10.20.30', '0.0.0'])('accepts %s', (version) => {
    const text = `${FORMAT}${NAME}version: ${version}\n${INTENT}${STAGES}`;
    expect(codesOf(text)).toEqual([]);
  });

  it.each([
    ["'1.1'"],
    ["'1'"],
    ["'1.0.0.0'"],
    ["'01.0.0'"],
    ["'1.0.0-rc.1'"],
    ["'v1.0.0'"],
    ["''"],
  ])('is INVALID_VALUE for %s, with the suggestion 0.1.0', (version) => {
    const text = `${FORMAT}${NAME}version: ${version}\n${INTENT}${STAGES}`;
    const { diagnostics } = checkWorkflowText(text, 'hello');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'INVALID_VALUE',
      path: 'version',
      line: 3,
      suggestion: '0.1.0',
    });
  });

  it('is INVALID_VALUE at the string and WRONG_TYPE at a number, for 1.1', () => {
    const quoted = `${FORMAT}${NAME}version: '1.1'\n${INTENT}${STAGES}`;
    expect(spansOf(quoted)).toEqual([
      ['INVALID_VALUE', 'version', 3, 10, 3, 15],
    ]);
    const bare = `${FORMAT}${NAME}version: 1.1\n${INTENT}${STAGES}`;
    expect(codesOf(bare)).toEqual([['WRONG_TYPE', 'version', 3, 10]]);
  });
});

describe('keys of a later slice', () => {
  // Each key with the slice that adds it, as the specification lists them,
  // and the line and column where the check finds the key in the text.
  const TOP = (key: string) => `${HEAD}${key}: x\n${STAGES}`;
  const LATER: [
    path: string,
    slice: string,
    text: string,
    line: number,
    column: number,
  ][] = [
    ['fallback_sop', '11b', TOP('fallback_sop'), 6, 1],
    ['runner_options', '12', TOP('runner_options'), 6, 1],
    ['targets', '14', TOP('targets'), 6, 1],
    [
      'intent.writes',
      '3b',
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  writes: []\n${STAGES}`,
      6,
      3,
    ],
    [
      'intent.accept[].run',
      '3a',
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: a\n      run: [make, test]\n${STAGES}`,
      8,
      7,
    ],
    [
      'params.<name>',
      '2',
      `${HEAD}params:\n  topic:\n    type: string\n${STAGES}`,
      7,
      3,
    ],
    ['stages[].outputs', '2', stageWith('outputs: {a: A.md}'), 9, 5],
    ['stages[].done_when', '3a', stageWith('done_when: [a]'), 9, 5],
    ['stages[].on_fail', '4', stageWith('on_fail: x'), 9, 5],
    ['stages[].max_iterations', '4', stageWith('max_iterations: 2'), 9, 5],
    ['stages[].on_exhausted', '4', stageWith('on_exhausted: x'), 9, 5],
    ['stages[].parallel', '6', stageWith('parallel: []'), 9, 5],
    ['stages[].renamed_from', '8', stageWith('renamed_from: a'), 9, 5],
    ['stages[].required', '8', stageWith('required: true'), 9, 5],
    ['stages[].effort', '13', stageWith('effort: low'), 9, 5],
    ['stages[].model', '13', stageWith('model: fast'), 9, 5],
  ];

  it.each(LATER)(
    'names the slice of %s, which is slice %s',
    (_, slice, text, line, column) => {
      const { diagnostics, view } = checkWorkflowText(text, 'hello');
      const found = diagnostics.filter(
        (d) => d.code === 'NOT_SUPPORTED_BY_THIS_BUILD',
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ severity: 'error', line, column });
      expect(found[0]?.message).toContain(`Slice ${slice} adds it.`);
      expect(diagnostics.map((d) => d.code)).not.toContain('UNKNOWN_KEY');
      expect(view).toBeNull();
    },
  );

  it.each([
    ['run', '3b'],
    ['human_review', '5'],
    ['human_input', '5'],
    ['uses', '7'],
  ])('names the slice of the stage kind %s, and is a kind', (kind, slice) => {
    const text = `${HEAD}stages:\n  - name: write\n    ${kind}: x\n`;
    const { diagnostics } = checkWorkflowText(text, 'hello');
    expect(diagnostics.map((d) => d.code)).toEqual([
      'NOT_SUPPORTED_BY_THIS_BUILD',
    ]);
    expect(diagnostics[0]?.message).toContain(`Slice ${slice} adds it.`);
  });

  it('names the slice at the key, with the key path', () => {
    expect(spansOf(stageWith('parallel: []'))).toEqual([
      ['NOT_SUPPORTED_BY_THIS_BUILD', 'stages.write.parallel', 9, 5, 9, 13],
    ]);
  });

  it('names slice 13 for the string form of intent, at the value', () => {
    const text = `${FORMAT}${NAME}${VERSION}intent: Say hello\n${STAGES}`;
    const [found, ...rest] = checkWorkflowText(text, 'hello').diagnostics;
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      code: 'NOT_SUPPORTED_BY_THIS_BUILD',
      path: 'intent',
      line: 4,
      column: 9,
      end_column: 18,
    });
    expect(found?.message).toContain('Slice 13 adds it.');
  });

  it('names slice 2 for a reference in a prompt, at the value', () => {
    const text = stageWith('prompt: Read {plan.design} and {run.goal}.');
    const [found, ...rest] = checkWorkflowText(text, 'hello').diagnostics;
    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      code: 'NOT_SUPPORTED_BY_THIS_BUILD',
      path: 'stages.write.prompt',
      line: 9,
    });
    expect(found?.message).toContain('Slice 2 adds it.');
  });

  it('does not echo the name of a param', () => {
    const text = `${HEAD}params:\n  AKIAIOSFODNN7EXAMPLE: x\n${STAGES}`;
    const [found] = checkWorkflowText(text, 'hello').diagnostics;
    expect(found?.code).toBe('NOT_SUPPORTED_BY_THIS_BUILD');
    expect(found?.message).not.toContain('AKIA');
    expect(found?.message).toContain('Slice 2 adds it.');
  });

  it('is still an unknown key when no slice plans it', () => {
    const [found] = checkWorkflowText(
      stageWith('concurrency: 4'),
      'hello',
    ).diagnostics;
    expect(found).toMatchObject({ code: 'UNKNOWN_KEY' });
  });
});

describe('planned forms of released keys', () => {
  it('reports params as a list of names with WRONG_TYPE', () => {
    expect(codesOf(`${HEAD}params: [goal]\n${STAGES}`)).toEqual([
      ['WRONG_TYPE', 'params', 6, 9],
    ]);
  });

  it('reports a description of the workflow as an unknown key', () => {
    const [found] = checkWorkflowText(
      `${HEAD}description: A greeting\n${STAGES}`,
      'hello',
    ).diagnostics;
    expect(found).toMatchObject({ code: 'UNKNOWN_KEY', path: 'description' });
  });

  it('reports a key of a param other than description and default as unknown', () => {
    const text = `${HEAD}params:\n  goal:\n    type: string\n${STAGES}`;
    expect(codesOf(text)).toEqual([['UNKNOWN_KEY', 'params.goal.type', 8, 5]]);
  });

  it('reports outputs and a run string as the later keys they are', () => {
    const outputs = stageWith('outputs:', '  design: {path: D.md}');
    expect(codesOf(outputs)).toEqual([
      ['NOT_SUPPORTED_BY_THIS_BUILD', 'stages.write.outputs', 9, 5],
    ]);
    const run = `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: a\n      run: make test\n${STAGES}`;
    expect(codesOf(run)).toEqual([
      ['NOT_SUPPORTED_BY_THIS_BUILD', 'intent.accept[0].run', 8, 7],
    ]);
  });
});

describe('the kind of a stage', () => {
  it('is STAGE_KIND_MISSING when no key names it, at the stage', () => {
    const text = `${HEAD}stages:\n  - name: write\n    prompt: x\n`;
    expect(spansOf(text)).toEqual([
      ['STAGE_KIND_MISSING', 'stages.write', 7, 5, 9, 1],
    ]);
  });

  it('is STAGE_KIND_AMBIGUOUS when two keys name it, at the stage', () => {
    const text = stageWith('uses: other');
    expect(spansOf(text)).toEqual([
      ['STAGE_KIND_AMBIGUOUS', 'stages.write', 7, 5, 10, 1],
      ['NOT_SUPPORTED_BY_THIS_BUILD', 'stages.write.uses', 9, 5, 9, 9],
    ]);
  });

  it('counts a repeated kind key once', () => {
    const text = `${HEAD}stages:\n  - name: write\n    agent: a\n    agent: b\n`;
    expect(codesOf(text)).toEqual([
      ['DUPLICATE_KEY', 'stages.write.agent', 9, 5],
    ]);
  });
});

describe('values', () => {
  it.each([
    [FORMAT + NAME + 'version: 1.1\n' + INTENT + STAGES, 'version', 3],
    ['format: 5\n' + NAME + VERSION + INTENT + STAGES, 'format', 1],
    [FORMAT + 'name: 123\n' + VERSION + INTENT + STAGES, 'name', 2],
    [FORMAT + 'name: true\n' + VERSION + INTENT + STAGES, 'name', 2],
    [FORMAT + NAME + VERSION + 'intent: [a]\n' + STAGES, 'intent', 4],
    [FORMAT + NAME + VERSION + 'intent: 5\n' + STAGES, 'intent', 4],
    [`${HEAD}stages: write\n`, 'stages', 6],
    [
      `${HEAD}stages:\n  - name: write\n    agent: 5\n`,
      'stages.write.agent',
      8,
    ],
    [
      `${HEAD}stages:\n  - name:\n    agent: k-developer\n`,
      'stages[0].name',
      7,
    ],
    [stageWith('prompt: 5'), 'stages.write.prompt', 9],
    [stageWith('prompt_file: [a]'), 'stages.write.prompt_file', 9],
    [`${HEAD}params:\n  goal: x\n${STAGES}`, 'params.goal', 7],
    [
      `${HEAD}params:\n  goal:\n    default: 5\n${STAGES}`,
      'params.goal.default',
      8,
    ],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept: a\n${STAGES}`,
      'intent.accept',
      6,
    ],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - a\n${STAGES}`,
      'intent.accept[0]',
      7,
    ],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: 5\n${STAGES}`,
      'intent.outcome',
      5,
    ],
  ])('is WRONG_TYPE for a value of another kind (%#)', (text, path, line) => {
    const found = codesOf(text).find((d) => d[0] === 'WRONG_TYPE');
    expect(found?.slice(1, 3)).toEqual([path, line]);
  });

  it('is NOT_A_MAPPING for a stage that is not a mapping', () => {
    expect(codesOf(`${HEAD}stages:\n  - write\n`)).toEqual([
      ['NOT_A_MAPPING', 'stages[0]', 7, 5],
    ]);
  });

  it('is INVALID_NAME for a string that is not a name', () => {
    const text = `${HEAD}stages:\n  - name: Write\n    agent: k_developer\n`;
    expect(codesOf(text)).toEqual([
      ['INVALID_NAME', 'stages[0].name', 7, 11],
      ['INVALID_NAME', 'stages[0].agent', 8, 12],
    ]);
  });

  it('is INVALID_NAME for a check id that is not a name', () => {
    const text = `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: Plan Exists\n      file: PLAN.md\n${STAGES}`;
    expect(codesOf(text)).toEqual([
      ['INVALID_NAME', 'intent.accept[0].id', 7, 11],
    ]);
  });

  it('is RESERVED_NAME for start, end, run and halt', () => {
    const text = `${HEAD}stages:\n  - name: end\n    agent: k-developer\n`;
    expect(codesOf(text)).toEqual([['RESERVED_NAME', 'stages[0].name', 7, 11]]);
  });

  it('is DUPLICATE_STAGE for the later of two equal stage names', () => {
    const text = `${STAGES}  - name: write\n    agent: k-developer\n`;
    expect(spansOf(HEAD + text)).toEqual([
      ['DUPLICATE_STAGE', 'stages[1].name', 9, 11, 9, 16],
    ]);
  });

  it('is NAME_MISMATCH when name is not the name of the file', () => {
    expect(
      codesOf(`${FORMAT}name: other\n${VERSION}${INTENT}${STAGES}`),
    ).toEqual([['NAME_MISMATCH', 'name', 2, 7]]);
  });

  it.each([
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: ''\n${STAGES}`,
      'intent.outcome',
    ],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: |\n    one\n    two\n${STAGES}`,
      'intent.outcome',
    ],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: ${'x'.repeat(301)}\n${STAGES}`,
      'intent.outcome',
    ],
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
    [stageWith('prompt: ""'), 'stages.write.prompt'],
    [stageWith(`prompt: ${'x'.repeat(32_769)}`), 'stages.write.prompt'],
    [stageWith('prompt: x', 'prompt_file: x.md'), 'stages.write.prompt_file'],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: a\n      file: PLAN.md\n    - id: a\n      file: B.md\n${STAGES}`,
      'intent.accept[1].id',
    ],
    [
      `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: a\n${STAGES}`,
      'intent.accept[0]',
    ],
  ])('is INVALID_VALUE for a value out of range (%#)', (text, path) => {
    expect(codesOf(text).map((d) => d.slice(0, 2))).toEqual([
      ['INVALID_VALUE', path],
    ]);
  });

  it('is INVALID_VALUE, and names run, for a check with both file and run', () => {
    const text = `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: a\n      file: A.md\n      run: [make]\n${STAGES}`;
    expect(codesOf(text)).toEqual([
      ['INVALID_VALUE', 'intent.accept[0]', 7, 7],
      ['NOT_SUPPORTED_BY_THIS_BUILD', 'intent.accept[0].run', 9, 7],
    ]);
  });

  it('accepts an intent of 300 characters, counting code points', () => {
    const text = `${FORMAT}${NAME}${VERSION}intent:\n  outcome: "${'😀'.repeat(300)}"\n${STAGES}`;
    expect(codesOf(text)).toEqual([]);
  });

  it('accepts a prompt of 32768 characters, counting code points', () => {
    expect(codesOf(stageWith(`prompt: "${'😀'.repeat(32_768)}"`))).toEqual([]);
  });
});

describe('a path', () => {
  const inCheck = (file: string) =>
    `${FORMAT}${NAME}${VERSION}intent:\n  outcome: x\n  accept:\n    - id: a\n      file: ${file}\n${STAGES}`;

  it.each(['PLAN.md', 'docs/design.md', 'a..b', '...', './a', 'a//b', 'a b'])(
    'accepts %s',
    (file) => {
      expect(codesOf(inCheck(`'${file}'`))).toEqual([]);
    },
  );

  it.each(['/etc/passwd', '..', '../x', 'a/../b', 'a/..', "''"])(
    'is INVALID_VALUE for %s in a check',
    (file) => {
      const quoted = file === "''" ? file : `'${file}'`;
      expect(codesOf(inCheck(quoted))).toEqual([
        ['INVALID_VALUE', 'intent.accept[0].file', 8, 13],
      ]);
    },
  );

  it('is INVALID_VALUE for a prompt_file that leaves its folder', () => {
    expect(codesOf(stageWith("prompt_file: '../review.md'"))).toEqual([
      ['INVALID_VALUE', 'stages.write.prompt_file', 9, 18],
    ]);
  });

  it('is INVALID_VALUE for a path with a line break', () => {
    expect(codesOf(inCheck('"a\\nb"'))).toEqual([
      ['INVALID_VALUE', 'intent.accept[0].file', 8, 13],
    ]);
  });
});

describe('params', () => {
  it('takes a description and a default for the goal', () => {
    const text = `${HEAD}params:\n  goal:\n    description: d\n    default: g\n${STAGES}`;
    expect(checkWorkflowText(text, 'hello').view?.params).toEqual({
      goal: { description: 'd', default: 'g' },
    });
  });

  it('takes a goal with nothing in it', () => {
    const text = `${HEAD}params:\n  goal: {}\n${STAGES}`;
    expect(checkWorkflowText(text, 'hello').view?.params).toEqual({ goal: {} });
  });
});

describe('positions', () => {
  it('count code points, not UTF-16 units', () => {
    const text = `${FORMAT}name: "😀😀"\n${VERSION}${INTENT}${STAGES}`;
    expect(spansOf(text)).toEqual([['INVALID_NAME', 'name', 2, 7, 2, 11]]);
  });

  it('count a tab as one column', () => {
    const text = `${FORMAT}name:\tHello\n${VERSION}${INTENT}${STAGES}`;
    expect(codesOf(text)).toEqual([['INVALID_NAME', 'name', 2, 7]]);
  });

  it('end a line at a lone CR or at CRLF as well as at LF', () => {
    const lone = `${HEAD.replaceAll('\n', '\r')}owner: 1\r${STAGES.replaceAll('\n', '\r')}`;
    expect(codesOf(lone)).toEqual([['UNKNOWN_KEY', 'owner', 6, 1]]);
    const crlf = `${HEAD.replaceAll('\n', '\r\n')}owner: 1\r\n${STAGES}`;
    expect(codesOf(crlf)).toEqual([['UNKNOWN_KEY', 'owner', 6, 1]]);
  });
});

describe('a key in a message', () => {
  function unknownKeyMessage(key: string): string | undefined {
    const text = `${HEAD}${key}: 1\n${STAGES}`;
    return checkWorkflowText(text, 'hello').diagnostics.find(
      (d) => d.code === 'UNKNOWN_KEY',
    )?.message;
  }

  it('is named when it is a short plain word', () => {
    expect(unknownKeyMessage('owner')).toBe('Unknown key `owner`.');
    expect(unknownKeyMessage('max_retries')).toBe('Unknown key `max_retries`.');
    expect(unknownKeyMessage('key2')).toBe('Unknown key `key2`.');
  });

  it.each([
    ['an access key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['a 32-digit hex key', '0123456789abcdef0123456789abcdef'],
    ['a token with a prefix', `ghp_${'a'.repeat(36)}`],
    ['a word of 12 characters with a digit', 'abcdefgh1234'],
    ['a long word', 'a'.repeat(25)],
  ])('is not shown for %s', (_, key) => {
    const message = unknownKeyMessage(key);
    expect(message).toBe('Unknown key (not shown).');
  });
});
