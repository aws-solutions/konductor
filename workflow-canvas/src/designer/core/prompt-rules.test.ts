// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  withStages,
  type StageToWrite,
  type ViewStages,
  type Written,
} from './stage-text';

const VIEW: ViewStages = {
  stages: [
    { name: 'plan', agent: 'k-architect' },
    { name: 'build', agent: 'k-developer' },
  ],
};

const HEAD = [
  'format: konductor/1',
  'name: hello',
  'version: 0.1.0',
  'stages:',
];

// A file whose stages hold `first` and `second` as lines of an item.
function fileOf(first: string[], second: string[], eol = '\n'): string {
  const lines = [
    ...HEAD,
    '  - name: plan',
    '    agent: k-architect',
    ...first,
    '  - name: build',
    '    agent: k-developer',
    ...second,
  ];
  return lines.join(eol) + eol;
}

// The stages of the view, the first one asked for `prompt`.
function asking(prompt: string, second?: string): StageToWrite[] {
  return VIEW.stages.map((stage, from) => ({
    ...stage,
    from,
    ...(from === 0
      ? { prompt }
      : second === undefined
        ? {}
        : { prompt: second }),
  }));
}

function textOf(written: Written): string {
  if (!written.ok) throw new Error(`The writer refused: ${written.reason}`);
  return written.text;
}

function reasonOf(written: Written): string {
  if (written.ok) throw new Error('The writer wrote the change.');
  return written.reason;
}

const promptOf = (text: string, at: number) =>
  (parse(text) as { stages: { prompt?: string }[] }).stages[at]?.prompt;

describe('a prompt edit that the writer refuses, and says why', () => {
  it('refuses a stage with two prompt keys', () => {
    const file = fileOf(['    prompt: a', '    prompt: b'], []);

    expect(reasonOf(withStages(file, VIEW, asking('c')))).toContain(
      'two `prompt` keys',
    );
  });

  it('refuses a stage with a prompt and a prompt_file, and picks neither', () => {
    const file = fileOf(['    prompt: a', '    prompt_file: a.md'], []);

    expect(reasonOf(withStages(file, VIEW, asking('c')))).toContain(
      'both `prompt` and `prompt_file`',
    );
  });

  it('refuses a prompt that is an alias', () => {
    const file = fileOf(['    prompt: &p text'], ['    prompt: *p']);
    const refused = withStages(file, VIEW, asking('', 'other'));

    expect(reasonOf(refused)).toContain('an alias, or has an anchor or a tag');
  });

  it('refuses a prompt that has an anchor', () => {
    const file = fileOf(['    prompt: &p text'], []);

    expect(reasonOf(withStages(file, VIEW, asking('other')))).toContain(
      'an anchor',
    );
  });

  it('refuses a prompt that has a tag', () => {
    const file = fileOf(['    prompt: !!str text'], []);

    expect(reasonOf(withStages(file, VIEW, asking('other')))).toContain(
      'a tag',
    );
  });

  it('refuses a prompt in a file that uses a << merge key', () => {
    const file = fileOf(['    prompt: a'], []).replace(
      'name: hello\n',
      'name: hello\nbase: &b\n  x: 1\nextra:\n  <<: *b\n',
    );

    expect(reasonOf(withStages(file, VIEW, asking('c')))).toContain(
      '`<<` merge key',
    );
  });

  it('writes nothing for the prompt that it leaves alone in such a file', () => {
    const file = fileOf(['    prompt: a'], []).replace(
      'name: hello\n',
      'name: hello\nextra:\n  <<: {x: 1}\n',
    );

    expect(textOf(withStages(file, VIEW, asking('a')))).toBe(file);
  });
});

describe('an existing block scalar', () => {
  const lines = (header: string) => [`    prompt: ${header}`, '      old'];

  it.each([
    ['|', 'One.', '|-\n      One.\n'],
    ['>', 'One.', '>-\n      One.\n'],
    ['>-', 'One.\n', '>\n      One.\n'],
    ['|+', 'One.\n\n', '|+\n      One.\n\n'],
    ['|', 'One\ntwo', '|-\n      One\n      two\n'],
  ])(
    'keeps its style %s and sets the chomping from the text %j',
    (header, typed, written) => {
      const file = fileOf(lines(header), []);

      const after = textOf(withStages(file, VIEW, asking(typed)));

      expect(after).toBe(file.replace(`${header}\n      old\n`, written));
      expect(promptOf(after, 0)).toBe(typed);
    },
  );

  it('keeps its indentation indicator, and indents the lines by it', () => {
    const file = fileOf(['    prompt: |4-', '        old'], []);

    const after = textOf(withStages(file, VIEW, asking('One\ntwo')));

    expect(after).toBe(
      file.replace('|4-\n        old\n', '|4-\n        One\n        two\n'),
    );
    expect(promptOf(after, 0)).toBe('One\ntwo');
  });

  it('keeps the comment on its header line', () => {
    const file = fileOf(['    prompt: >-  # why', '      old'], []);

    expect(textOf(withStages(file, VIEW, asking('New.')))).toBe(
      file.replace('>-  # why\n      old\n', '>-  # why\n      New.\n'),
    );
  });

  it('writes a literal block where a folded one would read back differently', () => {
    const file = fileOf(lines('>-'), []);

    const after = textOf(withStages(file, VIEW, asking('One\ntwo\n\nthree')));

    expect(after).toBe(
      file.replace(
        '>-\n      old\n',
        '|-\n      One\n      two\n\n      three\n',
      ),
    );
    expect(promptOf(after, 0)).toBe('One\ntwo\n\nthree');
  });

  it('keeps a folded block for text that it reads back', () => {
    const file = fileOf(lines('>'), []);

    expect(
      promptOf(textOf(withStages(file, VIEW, asking('One line.\n'))), 0),
    ).toBe('One line.\n');
    expect(textOf(withStages(file, VIEW, asking('One line.\n')))).toContain(
      'prompt: >\n      One line.\n',
    );
  });

  it('adds an indentation indicator when the first line starts with a space', () => {
    const file = fileOf(lines('|'), []);

    const after = textOf(withStages(file, VIEW, asking('  indented\nnext')));

    expect(after).toBe(
      file.replace('|\n      old\n', '|2-\n        indented\n      next\n'),
    );
    expect(promptOf(after, 0)).toBe('  indented\nnext');
  });

  it('adds the indicator to a new block too, and to one that starts with line breaks', () => {
    const none = fileOf([], []);

    const after = textOf(withStages(none, VIEW, asking('\n x\ny')));

    expect(after).toContain('    prompt: |2-\n\n       x\n      y\n');
    expect(promptOf(after, 0)).toBe('\n x\ny');
  });

  it('is replaced by a double-quoted value when the text cannot be in a block', () => {
    const file = fileOf(lines('|'), []);

    const after = textOf(withStages(file, VIEW, asking('a\u0085b')));

    expect(after).toBe(file.replace('|\n      old\n', '"a\\u0085b"\n'));
  });
});

describe('a plain or quoted value', () => {
  it.each([
    ['a colon and a space', 'a: b', '"a: b"'],
    ['a space and a hash', 'a #b', '"a #b"'],
    ['a leading dash', '- a', '"- a"'],
    ['a leading question mark', '? a', '"? a"'],
    ['a leading bracket', '[a]', '"[a]"'],
    ['a leading brace', '{a}', '"{a}"'],
    ['a leading ampersand', '&a', '"&a"'],
    ['a leading asterisk', '*a', '"*a"'],
    ['a leading exclamation mark', '!a', '"!a"'],
    ['a leading pipe', '|a', '"|a"'],
    ['a leading greater-than sign', '>a', '"&gt;a"'.replace('&gt;', '>')],
    ['a leading percent sign', '%a', '"%a"'],
    ['a leading at sign', '@a', '"@a"'],
    ['a leading backtick', '`a', '"`a"'],
    ['a leading single quote', "'a", `"'a"`],
    ['a leading double quote', '"a', '"\\"a"'],
    ['a leading space', ' a', '" a"'],
    ['a trailing space', 'a ', '"a "'],
  ])('with %s gets double quotes', (_, typed, written) => {
    for (const old of ['old', "'old'", '"old"']) {
      const file = fileOf([`    prompt: ${old}`], []);

      const after = textOf(withStages(file, VIEW, asking(typed)));

      expect(after).toBe(file.replace(`prompt: ${old}`, `prompt: ${written}`));
      expect(promptOf(after, 0)).toBe(typed);
    }
  });

  it('with a line break becomes a block scalar', () => {
    for (const old of ['old', "'old'", '"old"']) {
      const file = fileOf([`    prompt: ${old}`], []);

      const after = textOf(withStages(file, VIEW, asking('a\nb')));

      expect(after).toBe(
        file.replace(`prompt: ${old}`, 'prompt: |-\n      a\n      b'),
      );
    }
  });
});

describe('a file with CRLF line endings', () => {
  const crlf = (...lines: string[]) => lines.join('\r\n') + '\r\n';

  it('gets the typed text with CRLF line breaks', () => {
    const file = fileOf(['    prompt: old'], [], '\r\n');

    const after = textOf(withStages(file, VIEW, asking('a\nb\n')));

    expect(after).toBe(
      file.replace('prompt: old', 'prompt: |\r\n      a\r\n      b'),
    );
    expect(after.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(promptOf(after, 0)).toBe('a\nb\n');
  });

  it('writes a new block with CRLF too', () => {
    const file = fileOf([], [], '\r\n');

    const after = textOf(withStages(file, VIEW, asking('a\nb')));

    expect(after.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(after).toContain('    prompt: |-\r\n      a\r\n      b\r\n');
  });

  it('treats a typed CRLF as one line break, and compares without the carriage returns', () => {
    const file = fileOf(['    prompt: old'], [], '\r\n');

    const after = textOf(withStages(file, VIEW, asking('a\r\nb')));

    expect(promptOf(after, 0)).toBe('a\nb');
    expect(after).toContain('prompt: |-\r\n      a\r\n      b\r\n');
  });

  it('removes a prompt in the middle of the file with its CRLF line', () => {
    const file = crlf(
      ...HEAD,
      '  - name: plan',
      '    agent: k-architect',
      '    prompt: old',
      '  - name: build',
      '    agent: k-developer',
    );

    expect(textOf(withStages(file, VIEW, asking('')))).toBe(
      file.replace('    prompt: old\r\n', ''),
    );
  });
});

describe('a prompt on the last line of a file with no final line break', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])(
    'is removed with the break before it, so the file ends as it did (%s)',
    (_, eol) => {
      const lines = [
        ...HEAD,
        '  - name: plan',
        '    agent: k-architect',
        '  - name: build',
        '    agent: k-developer',
        '    prompt: last',
      ];
      const file = lines.join(eol);

      const after = textOf(
        withStages(file, VIEW, [
          { ...VIEW.stages[0]!, from: 0 },
          { ...VIEW.stages[1]!, from: 1, prompt: '' },
        ]),
      );

      expect(after).toBe(lines.slice(0, -1).join(eol));
      expect(after.endsWith(eol)).toBe(false);
    },
  );

  it('is removed in the same way when it is a block scalar', () => {
    const lines = [
      ...HEAD,
      '  - name: plan',
      '    agent: k-architect',
      '  - name: build',
      '    agent: k-developer',
      '    prompt: |-',
      '      last',
    ];
    const file = lines.join('\n');

    const after = textOf(
      withStages(file, VIEW, [
        { ...VIEW.stages[0]!, from: 0 },
        { ...VIEW.stages[1]!, from: 1, prompt: '' },
      ]),
    );

    expect(after).toBe(lines.slice(0, -2).join('\n'));
  });

  it('keeps its final line break when the file has one', () => {
    const lines = [
      ...HEAD,
      '  - name: plan',
      '    agent: k-architect',
      '  - name: build',
      '    agent: k-developer',
      '    prompt: last',
    ];
    const file = lines.join('\n') + '\n';

    const after = textOf(
      withStages(file, VIEW, [
        { ...VIEW.stages[0]!, from: 0 },
        { ...VIEW.stages[1]!, from: 1, prompt: '' },
      ]),
    );

    expect(after).toBe(lines.slice(0, -1).join('\n') + '\n');
  });
});
