// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { willRewriteWhole, withStages } from './stage-text';

const VIEW = {
  name: 'hello',
  intent: { outcome: 'Add a greeting to the README' },
  stages: [{ name: 'draft', agent: 'k-developer' }],
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
      "# Greets\nversion: '1.1'\nname: hello\nintent: Say hi\n\nstages: # in order\n  - name: a\n    agent: k-developer\n  - name: b\n    agent: k-tpm\n\n# the end\n",
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
      'name: hello\n# kept\nstages:\n  # dropped\n  - name: a\n    agent: k-tpm\n';

    const next = withStages(text, VIEW, [{ name: 'a', agent: 'k-tpm' }]);

    expect(willRewriteWhole(text)).toBe(false);
    expect(next).toContain('# kept');
    expect(next).not.toContain('# dropped');
  });
});
