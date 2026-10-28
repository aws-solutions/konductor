// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { willRewriteWhole, withStages } from './stage-text';

const VIEW = {
  name: 'hello',
  intent: { outcome: 'Add a greeting to the README' },
  stages: [{ name: 'draft', agent: 'k-developer' }],
};

const COMMENTED = [
  '# about the workflow',
  'name: wf',
  'intent: Say hi',
  'stages:',
  '  # the first one',
  '  - {name: a, agent: x} # flow style',
  '',
  '  # the second one',
  '  - agent: y',
  "    name: 'b'",
  '  - name: c',
  '    agent: z',
  '  # about the end',
  '# footer',
  '',
].join('\n');
const COMMENTED_VIEW = {
  name: 'wf',
  intent: { outcome: 'Say hi' },
  stages: [
    { name: 'a', agent: 'x' },
    { name: 'b', agent: 'y' },
    { name: 'c', agent: 'z' },
  ],
};

const TEXT =
  'name: hello\nintent: Add a greeting to the README\nstages:\n  - name: draft\n    agent: k-developer\n  - name: review\n    agent: k-quality-assurance\n';

const REVIEW = { name: 'review', agent: 'k-quality-assurance' };

describe('withStages', () => {
  it('changes an agent and nothing else', () => {
    const next = withStages(TEXT, VIEW, [
      { name: 'draft', agent: 'k-architect' },
      REVIEW,
    ]);

    expect(next).toBe(TEXT.replace('k-developer', 'k-architect'));
  });

  it('writes the same text back when the stages are the same', () => {
    expect(
      withStages(TEXT, VIEW, [{ name: 'draft', agent: 'k-developer' }, REVIEW]),
    ).toBe(TEXT);
  });

  it('keeps the keys, comments and blank lines around the stages', () => {
    const text =
      "# Greets\nversion: '1.1'\nname: hello\nintent: Say hi\n\nstages: # in order\n  # first\n  - name: a\n    agent: k-developer\n\n# the end\n";

    const next = withStages(text, VIEW, [
      { name: 'a', agent: 'k-developer' },
      { name: 'b', agent: 'k-tpm' },
    ]);

    expect(next).toBe(
      "# Greets\nversion: '1.1'\nname: hello\nintent: Say hi\n\nstages: # in order\n  # first\n  - name: a\n    agent: k-developer\n  - name: b\n    agent: k-tpm\n\n# the end\n",
    );
  });

  it('keeps a key that comes after the stages', () => {
    const text =
      'name: hello\nstages:\n- name: a\n  agent: k-developer\nintent: Say hi\n';

    const next = withStages(text, VIEW, [{ name: 'b', agent: 'k-tpm' }]);

    expect(next).toBe(
      'name: hello\nstages:\n  - name: b\n    agent: k-tpm\nintent: Say hi\n',
    );
  });

  it('stops the block at a document marker', () => {
    const text =
      'name: hello\nstages:\n  - name: a\n    agent: k-tpm\n---\nx: 1\n';

    const next = withStages(text, VIEW, [{ name: 'b', agent: 'k-tpm' }]);

    expect(next).toBe(
      'name: hello\nstages:\n  - name: b\n    agent: k-tpm\n---\nx: 1\n',
    );
  });

  it('adds no line break at the end of a file that has none', () => {
    const text = 'name: hello\nstages:\n  - name: a\n    agent: k-tpm';

    const next = withStages(text, VIEW, [{ name: 'a', agent: 'k-architect' }]);

    expect(next).toBe(
      'name: hello\nstages:\n  - name: a\n    agent: k-architect',
    );
  });

  it('keeps a file in CRLF line endings', () => {
    const text = TEXT.replaceAll('\n', '\r\n');

    const next = withStages(text, VIEW, [REVIEW]);

    expect(next).toBe(
      'name: hello\r\nintent: Add a greeting to the README\r\nstages:\r\n  - name: review\r\n    agent: k-quality-assurance\r\n',
    );
  });

  it('keeps a comment and a key after the stages of a CRLF file', () => {
    const text =
      'name: hello\r\nstages:\r\n  - name: a\r\n    agent: k-tpm\r\n# note\r\nversion: 1\r\n';

    const next = withStages(text, VIEW, [REVIEW]);

    expect(next).toBe(
      'name: hello\r\nstages:\r\n  - name: review\r\n    agent: k-quality-assurance\r\n# note\r\nversion: 1\r\n',
    );
  });

  it('adds no stray carriage return to a CRLF file that ends without a line break', () => {
    const text = 'name: hello\r\nstages:\r\n  - name: a\r\n    agent: k-tpm';

    const next = withStages(text, VIEW, [REVIEW]);

    expect(next).toBe(
      'name: hello\r\nstages:\r\n  - name: review\r\n    agent: k-quality-assurance',
    );
  });

  it('writes a name that is not plain text in double quotes', () => {
    const next = withStages(TEXT, VIEW, [
      { name: 'Bad: name #1', agent: 'true' },
      { name: '123', agent: '' },
      { name: 'trailing ', agent: 'say "hi"' },
    ]);

    expect(next).toContain('  - name: "Bad: name #1"\n    agent: "true"\n');
    expect(next).toContain('  - name: "123"\n    agent: ""\n');
    expect(next).toContain(
      '  - name: "trailing "\n    agent: "say \\"hi\\""\n',
    );
  });

  it('writes the whole file from the view when the stages are not a block', () => {
    const text =
      'name: hello\nintent: Say hi\nstages: [{name: a, agent: k-tpm}]\n';

    const next = withStages(text, VIEW, [{ name: 'b', agent: 'k-architect' }]);

    expect(next).toBe(
      'name: hello\nintent: Add a greeting to the README\nstages:\n  - name: b\n    agent: k-architect\n',
    );
  });

  it('quotes an intent that is not plain text when it writes the whole file', () => {
    const view = { ...VIEW, intent: { outcome: 'Fix: the #1 bug' } };

    const next = withStages('stages: []\n', view, [
      { name: 'a', agent: 'k-tpm' },
    ]);

    expect(next).toContain('intent: "Fix: the #1 bug"\n');
  });
});

describe('willRewriteWhole', () => {
  it('is false for stages in the block form', () => {
    expect(willRewriteWhole(TEXT)).toBe(false);
  });

  it('is false when a comment follows the key', () => {
    expect(willRewriteWhole('name: a\nstages: # run in order\n')).toBe(false);
  });

  it('is true for stages in the flow form', () => {
    expect(willRewriteWhole('stages: [{name: a, agent: k-tpm}]\n')).toBe(true);
  });

  it('is true when the text has no stages key', () => {
    expect(willRewriteWhole('name: a\n')).toBe(true);
  });

  it('agrees with what withStages does', () => {
    const text =
      'name: hello\n# kept\nstages:\n  - name: a\n    agent: k-tpm\n';

    const next = withStages(text, VIEW, [{ name: 'b', agent: 'k-tpm' }]);

    expect(willRewriteWhole(text)).toBe(false);
    expect(next).toContain('# kept');
  });

  it.each([
    [
      'a lone CR as the line break',
      'name: a\rstages:\r  - name: a\r    agent: x\r',
    ],
    ['a BOM before stages', '\uFEFFstages:\n  - name: a\n    agent: x\n'],
    ['a double-quoted key', 'name: a\n"stages":\n  - name: a\n    agent: x\n'],
    ['a single-quoted key', "name: a\n'stages':\n  - name: a\n    agent: x\n"],
  ])('does not rewrite the whole file for %s', (_, text) => {
    expect(willRewriteWhole(text)).toBe(false);
  });
});

describe('withStages, on a file with comments in the block', () => {
  const [A, B, C] = COMMENTED_VIEW.stages;

  it('keeps the lines and comments of the stages that are unchanged', () => {
    const next = withStages(COMMENTED, COMMENTED_VIEW, [
      A!,
      B!,
      { name: 'c', agent: 'w' },
    ]);

    expect(next).toBe(
      COMMENTED.replace(
        '  - name: c\n    agent: z\n',
        '  - name: c\n    agent: w\n',
      ),
    );
  });

  it('takes the comments in front of a deleted stage along with it', () => {
    const next = withStages(COMMENTED, COMMENTED_VIEW, [A!, C!]);

    expect(next).not.toContain('the second one');
    expect(next).toContain('the first one');
    expect(next).toContain('flow style');
    expect(next).toContain('  # about the end\n# footer\n');
  });

  it('keeps every comment and blank line after the last stage, indented or not', () => {
    const next = withStages(COMMENTED, COMMENTED_VIEW, [A!]);

    expect(next.endsWith('  # about the end\n# footer\n')).toBe(true);
  });

  it('moves the lines of a stage that moved, with its comments', () => {
    const next = withStages(COMMENTED, COMMENTED_VIEW, [B!, A!, C!]);

    expect(next.indexOf('the second one')).toBeLessThan(
      next.indexOf("name: 'b'"),
    );
    expect(next.indexOf("name: 'b'")).toBeLessThan(next.indexOf('flow style'));
  });

  it('writes a new stage in the plain layout after the others', () => {
    const next = withStages(COMMENTED, COMMENTED_VIEW, [
      A!,
      B!,
      C!,
      { name: 'd', agent: 'v' },
    ]);

    expect(next).toContain(
      '  - name: c\n    agent: z\n  - name: d\n    agent: v\n',
    );
  });

  it('writes every stage afresh when the items do not match the view', () => {
    const next = withStages(COMMENTED, { ...COMMENTED_VIEW, stages: [A!] }, [
      A!,
      B!,
    ]);

    expect(next).toContain(
      '  - name: a\n    agent: x\n  - name: b\n    agent: "y"\n',
    );
  });
});

describe('withStages, on line endings', () => {
  const ONE = {
    name: 'wf',
    intent: { outcome: 'x' },
    stages: [{ name: 'a', agent: 'x' }],
  };

  it('uses the line ending of the stages line in a file with mixed endings', () => {
    const text =
      'name: wf\nintent: x\n# c\r\nstages:\n  - name: a\n    agent: x\n';

    const next = withStages(text, ONE, [
      { name: 'a', agent: 'x' },
      { name: 'b', agent: 'k-tpm' },
    ]);

    expect(next).toBe(`${text}  - name: b\n    agent: k-tpm\n`);
  });

  it('keeps a file of lone CR as it is, and writes new lines with CR', () => {
    const text = 'name: wf\rintent: x\rstages:\r  - name: a\r    agent: x\r';

    const next = withStages(text, ONE, [
      { name: 'a', agent: 'x' },
      { name: 'b', agent: 'k-tpm' },
    ]);

    expect(next).toBe(`${text}  - name: b\r    agent: k-tpm\r`);
  });

  it('keeps a BOM in front of the stages key', () => {
    const text = '\uFEFFstages:\n  - name: a\n    agent: x\n';

    const next = withStages(text, ONE, [{ name: 'a', agent: 'k-tpm' }]);

    expect(next).toBe('\uFEFFstages:\n  - name: a\n    agent: k-tpm\n');
  });

  it('writes into a block under a quoted key', () => {
    const text = 'name: wf\n"stages":\n  - name: a\n    agent: x\n';

    const next = withStages(text, ONE, [{ name: 'a', agent: 'k-tpm' }]);

    expect(next).toBe('name: wf\n"stages":\n  - name: a\n    agent: k-tpm\n');
  });
});

describe('withStages, on words that YAML 1.1 reads as booleans', () => {
  it.each(['y', 'n', 'yes', 'no', 'on', 'off', 'Yes', 'OFF'])(
    'quotes the name %s',
    (name) => {
      const next = withStages(
        'name: wf\nstages:\n  - name: a\n    agent: x\n',
        VIEW,
        [{ name, agent: 'x' }],
      );

      expect(next).toContain(`- name: "${name}"`);
    },
  );
});
