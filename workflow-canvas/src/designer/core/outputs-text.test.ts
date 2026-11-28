// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { outputNameError, withOutputs } from './outputs-text';

const block = (eol = '\n') =>
  [
    'format: konductor/1',
    'version: 0.1.0',
    'intent:',
    '  outcome: Do it.',
    'stages:',
    '  - name: plan',
    '    agent: k-architect',
    '    outputs:',
    '      design: DESIGN.md',
  ].join(eol) + eol;

const write = (
  text: string,
  outputs: readonly { readonly name: string; readonly path: string }[],
  before: Readonly<Record<string, string>> = { design: 'DESIGN.md' },
) => withOutputs(text, [{ outputs, before }]);

const value = (written: ReturnType<typeof write>) => {
  expect(written.ok).toBe(true);
  if (!written.ok) throw new Error(written.reason);
  return written.text;
};

describe('withOutputs', () => {
  it.each([
    ['LF', block()],
    ['CRLF', block('\r\n')],
    ['BOM', `\uFEFF${block()}`],
    ['no final newline', block().slice(0, -1)],
  ])('changes a scalar and preserves the surrounding %s bytes', (_, text) => {
    const written = value(
      write(text, [{ name: 'design', path: 'docs/DESIGN.md' }]),
    );
    expect(written.replace('docs/DESIGN.md', 'DESIGN.md')).toBe(text);
    expect(parse(written).stages[0].outputs).toEqual({
      design: 'docs/DESIGN.md',
    });
  });

  it('edits a simple flow mapping without rebuilding the stage', () => {
    const text =
      'format: konductor/1\nversion: 0.1.0\nintent: {outcome: Do it.}\nstages: [{name: plan, agent: k-architect, outputs: {design: DESIGN.md}}]\n';
    const written = value(write(text, [{ name: 'notes', path: 'NOTES.md' }]));
    expect(written).toContain('outputs: {notes: NOTES.md}');
    expect(written).toContain('intent: {outcome: Do it.}');
  });

  it('adds a block mapping without changing comments around the stage', () => {
    const text = block().replace(
      '    outputs:\n      design: DESIGN.md\n',
      '    prompt: Plan it. # keep\n',
    );
    const written = value(
      write(text, [{ name: 'design', path: 'DESIGN.md' }], {}),
    );
    expect(written).toContain('    prompt: Plan it. # keep\n    outputs:\n');
  });

  it('removes the last row without consuming the next stage line', () => {
    const text = `${block()}  - name: review\n    agent: k-reviewer\n`;
    const written = withOutputs(text, [
      { outputs: [], before: { design: 'DESIGN.md' } },
      { outputs: [], before: {} },
    ]);
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error(written.reason);
    expect(parse(written.text).stages).toHaveLength(2);
    expect(parse(written.text).stages[0].outputs).toEqual({});
  });

  it('refuses structural edits that could move output comments', () => {
    const text = block().replace(
      '      design:',
      '      # primary\n      design:',
    );
    const written = write(text, [
      { name: 'design', path: 'DESIGN.md' },
      { name: 'notes', path: 'NOTES.md' },
    ]);
    expect(written).toEqual(
      expect.objectContaining({
        ok: false,
        reason: expect.stringContaining('comments'),
      }),
    );
  });

  it.each(['Bad', '1name', 'two_words', ''])(
    'rejects output name %j',
    (name) => {
      expect(outputNameError(name)).toBeDefined();
      expect(write(block(), [{ name, path: 'A.md' }])).toEqual(
        expect.objectContaining({ ok: false }),
      );
    },
  );
});
