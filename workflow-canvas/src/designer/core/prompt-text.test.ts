// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { StageView, WorkflowView } from '../../api/types';
import { withStages, type StageToWrite, type Written } from './stage-text';

const FIRST = { name: 'first', agent: 'k-developer' };
const MIDDLE = { name: 'middle', agent: 'k-architect' };
const LAST = { name: 'last', agent: 'k-tpm' };
const VIEW: WorkflowView = {
  name: 'hello',
  intent: { outcome: 'Say hi' },
  stages: [FIRST, MIDDLE, LAST],
};

const HEAD = [
  '# Greets the reader.',
  'format: konductor/1',
  'name: hello',
  'version: 0.1.0',
  'intent:',
  '  outcome: Say hi',
  'stages:',
];
// Neighbours of the stage under test, with block scalars that hold lines which
// look like YAML, so a stray edit shows up.
const BEFORE = [
  '  - name: first',
  '    agent: k-developer',
  '    prompt: |-',
  '      First prompt.',
  '      # not a comment',
  '        - not a list',
  '',
];
const AFTER = [
  '  # about the last stage',
  '  - name: last',
  '    agent: k-tpm',
  '    prompt: >',
  '      Last prompt,',
  '      folded.',
  '',
  '# after the stages',
];

// The middle stage in each layout that the writer finds a prompt in, as lines
// of an item; `old` is the text the layout holds.
const LAYOUTS: Record<string, { lines: string[]; old: string }> = {
  plain: {
    lines: ['  - name: middle', '    agent: k-architect', '    prompt: old'],
    old: 'old',
  },
  'single-quoted': {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      "    prompt: 'o''ld'",
    ],
    old: "o'ld",
  },
  'double-quoted': {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt: "o\\tld"',
    ],
    old: 'o\tld',
  },
  literal: {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt: |',
      '      old',
      '      text',
    ],
    old: 'old\ntext\n',
  },
  'literal, strip': {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt: |-',
      '      old',
      '      text',
    ],
    old: 'old\ntext',
  },
  'literal, keep': {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt: |+',
      '      old',
      '',
      '',
    ],
    old: 'old\n\n\n',
  },
  folded: {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt: >',
      '      old',
      '      text',
    ],
    old: 'old text\n',
  },
  'folded, strip': {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt: >-',
      '      old',
      '      text',
    ],
    old: 'old text',
  },
  'value on the next line': {
    lines: [
      '  - name: middle',
      '    agent: k-architect',
      '    prompt:',
      '      old',
    ],
    old: 'old',
  },
  'flow item': {
    lines: ['  - {name: middle, agent: k-architect, prompt: "old"}'],
    old: 'old',
  },
  'key first, after the dash': {
    lines: ['  - prompt: old', '    name: middle', '    agent: k-architect'],
    old: 'old',
  },
  'comments before, inside and after': {
    lines: [
      '  # before the stage',
      '  - name: middle # the name',
      '    # inside',
      '    agent: k-architect',
      '    prompt: old # the prompt',
      '    # after the prompt',
    ],
    old: 'old',
  },
};

// Layouts of a stage with no prompt, which a prompt is added to.
const NO_KEY: Record<string, string[]> = {
  'no prompt key': ['  - name: middle', '    agent: k-architect'],
  'no prompt key, comments before, inside and after': [
    '  # before the stage',
    '  - name: middle # the name',
    '    # inside',
    '    agent: k-architect # the agent',
    '',
    '    # after the stage',
  ],
};

const MIXED = [
  ...Object.entries(LAYOUTS).map(([k, v]) => [k, v.lines] as const),
];

const TEXTS: [string, string][] = [
  ['empty text', ''],
  ['one line', 'Write the plan.'],
  ['leading and trailing spaces', '  padded  '],
  ['tabs', '\tone\ttwo\t'],
  ['a hash', '# not a comment'],
  ['a colon and a space', 'key: value'],
  ['a dash and a space', '- item'],
  ['three dashes', '---'],
  ['three dots', '...'],
  ['a percent sign', '%YAML 1.2'],
  ['an ampersand', '&anchor value'],
  ['an asterisk', '*alias'],
  ['an exclamation mark', '!tag value'],
  ['a pipe', '|'],
  ['a greater-than sign', '>'],
  ['quotes and backslashes', 'it\'s "quoted" and a \\ and a \\n'],
  ['a first line that is blank', '\nsecond line'],
  ['only line breaks', '\n\n\n'],
  ['one trailing line break', 'one\n'],
  ['several trailing line breaks', 'one\n\n\n'],
  ['lines that look like YAML', 'a\n# b\n- c\n---\n...\nd: e\n'],
  ['indented lines', 'a\n  b\n\tc\n    d'],
  ['a first line that is indented', '  a\nb'],
  ['blank lines with spaces', 'a\n   \nb'],
  ['U+0085', 'a\u0085b'],
  ['U+2028', 'a\u2028b'],
  ['U+2029', 'a\u2029b'],
  ['U+007F', 'a\u007Fb'],
  ['a byte order mark', 'a\uFEFFb'],
  ['U+FFFE', 'a\uFFFEb'],
  ['lines with U+0085', 'a\nb\u0085c\n'],
  ['lines with U+2028 and U+2029', 'a\u2028\nb\u2029c'],
  ['lines with U+007F', 'a\nb\u007Fc'],
  ['a carriage return', 'a\r\nb'],
  ['a lone carriage return', 'a\rb'],
  ['a character outside the BMP', 'a\u{1F600}\nb'],
  [
    'a template reference',
    'Plan for {run.goal} with <script>alert(1)</script>',
  ],
  ['exactly 32768 characters', 'x'.repeat(32768)],
  [
    'exactly 32768 characters in lines',
    `${'y'.repeat(99)}\n`.repeat(327) + 'z'.repeat(35),
  ],
];

function fileOf(lines: string[], eol = '\n'): string {
  return [...HEAD, ...BEFORE, ...lines, ...AFTER].join(eol) + eol;
}

// The stages of the view, the middle one asked for `prompt`.
function asking(prompt: string | undefined): StageToWrite[] {
  return VIEW.stages.map((stage, from) =>
    from === 1 ? { ...stage, from, prompt } : { ...stage, from },
  );
}

interface Parsed {
  stages: (StageView & { prompt?: string })[];
}
const read = (text: string) => parse(text) as Parsed;

function textOf(written: Written): string {
  if (!written.ok) throw new Error(`The writer refused: ${written.reason}`);
  return written.text;
}

describe('withStages, writing a prompt', () => {
  describe.each(Object.entries(LAYOUTS))(
    'into a stage with a %s prompt',
    (_, layout) => {
      it.each(TEXTS)('reads back %s as typed', (__, typed) => {
        const before = fileOf(layout.lines);
        const flowRemoval = layout.lines[0]!.includes('{') && typed === '';
        const written = withStages(before, VIEW, asking(typed));

        if (flowRemoval) {
          expect(written.ok).toBe(false);
          return;
        }
        const after = textOf(written);
        const was = read(before);
        const now = read(after);
        expect(now.stages[1]?.prompt).toBe(typed === '' ? undefined : typed);
        expect(now.stages[0]).toEqual(was.stages[0]);
        expect(now.stages[2]).toEqual(was.stages[2]);
        expect(now.stages[1]?.name).toBe('middle');
        expect(now.stages[1]?.agent).toBe('k-architect');
        // The neighbours and everything around them are the same bytes.
        expect(after.startsWith([...HEAD, ...BEFORE].join('\n'))).toBe(true);
        expect(after.endsWith([...AFTER].join('\n') + '\n')).toBe(true);
      });
    },
  );

  describe.each(Object.entries(NO_KEY))('into a stage with %s', (_, lines) => {
    it.each(TEXTS)('reads back %s as typed', (__, typed) => {
      const before = fileOf(lines);
      const after = textOf(withStages(before, VIEW, asking(typed)));

      expect(read(after).stages[1]?.prompt).toBe(
        typed === '' ? undefined : typed,
      );
      expect(read(after).stages[0]).toEqual(read(before).stages[0]);
      expect(read(after).stages[2]).toEqual(read(before).stages[2]);
      if (typed === '') expect(after).toBe(before);
    });
  });

  describe.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('in a file with %s line endings', (_, eol) => {
    it.each(MIXED.concat(Object.entries(NO_KEY)))(
      'writes a block prompt into a stage with a %s layout, with the file endings',
      (__, lines) => {
        const before = fileOf([...lines], eol);
        const typed = 'one\ntwo\n\nthree\n';

        const after = textOf(withStages(before, VIEW, asking(typed)));

        expect(read(after).stages[1]?.prompt).toBe(typed);
        expect(after.replaceAll(eol, '')).not.toMatch(/[\r\n]/);
      },
    );
  });

  describe('the form of what is written', () => {
    const plain = fileOf(LAYOUTS.plain!.lines);

    it('writes one line as a plain scalar when that is safe', () => {
      expect(textOf(withStages(plain, VIEW, asking('New text.')))).toBe(
        plain.replace('prompt: old', 'prompt: New text.'),
      );
    });

    it('writes one line with a character YAML reads as syntax double-quoted', () => {
      expect(textOf(withStages(plain, VIEW, asking('a: b # c')))).toBe(
        plain.replace('prompt: old', 'prompt: "a: b # c"'),
      );
    });

    it('writes text with a line break as a literal block scalar, indented two more than the key', () => {
      expect(textOf(withStages(plain, VIEW, asking('one\n  two')))).toBe(
        plain.replace('prompt: old', 'prompt: |-\n      one\n        two'),
      );
    });

    it.each([
      ['none', 'a\nb', '|-', ['a', 'b']],
      ['one', 'a\nb\n', '|', ['a', 'b']],
      ['two', 'a\nb\n\n', '|+', ['a', 'b', '']],
      ['three', 'a\nb\n\n\n', '|+', ['a', 'b', '', '']],
    ])(
      'keeps %s trailing line breaks with the chomping %s',
      (_, typed, header, lines) => {
        const after = textOf(withStages(plain, VIEW, asking(typed)));
        const block = [header, ...lines.map((l) => (l ? `      ${l}` : ''))];

        expect(after).toBe(
          plain.replace('prompt: old', `prompt: ${block.join('\n')}`),
        );
      },
    );

    it.each([
      ['a carriage return', 'a\r\nb', '"a\\r\\nb"'],
      ['U+0085', 'a\nb\u0085c', '"a\\nb\\u0085c"'],
      ['U+2028', 'a\nb\u2028c', '"a\\nb\\u2028c"'],
      ['U+007F', 'a\nb\u007Fc', '"a\\nb\\u007fc"'],
      ['only line breaks', '\n\n', '"\\n\\n"'],
    ])(
      'writes text with %s double-quoted, since a block cannot say it',
      (_, typed, quotedValue) => {
        expect(textOf(withStages(plain, VIEW, asking(typed)))).toBe(
          plain.replace('prompt: old', `prompt: ${quotedValue}`),
        );
      },
    );

    it('writes into a flow item double-quoted, even one line', () => {
      const flow = fileOf(LAYOUTS['flow item']!.lines);

      expect(textOf(withStages(flow, VIEW, asking('a, b')))).toBe(
        flow.replace('prompt: "old"', 'prompt: "a, b"'),
      );
      expect(textOf(withStages(flow, VIEW, asking('a\nb')))).toBe(
        flow.replace('prompt: "old"', 'prompt: "a\\nb"'),
      );
    });

    it('does not put a block scalar in front of a comment', () => {
      const commented = fileOf(
        LAYOUTS['comments before, inside and after']!.lines,
      );

      expect(textOf(withStages(commented, VIEW, asking('a\nb')))).toBe(
        commented.replace(
          'prompt: old # the prompt',
          'prompt: "a\\nb" # the prompt',
        ),
      );
    });
  });

  describe('the bytes that change', () => {
    it('replaces only the value of a folded prompt, and nothing around it', () => {
      const before = fileOf(LAYOUTS['folded, strip']!.lines);
      const after = textOf(withStages(before, VIEW, asking('Say it.')));

      expect(after).toBe(
        before.replace(
          'prompt: >-\n      old\n      text\n',
          'prompt: >-\n      Say it.\n',
        ),
      );
    });

    it('replaces a block scalar with a block scalar', () => {
      const before = fileOf(LAYOUTS.literal!.lines);
      const after = textOf(withStages(before, VIEW, asking('x\ny\nz')));

      expect(after).toBe(
        before.replace(
          '|\n      old\n      text\n',
          '|-\n      x\n      y\n      z\n',
        ),
      );
    });

    it('replaces a kept block scalar and its kept blank lines', () => {
      const before = fileOf(LAYOUTS['literal, keep']!.lines);
      const after = textOf(withStages(before, VIEW, asking('a\nb\n')));

      expect(after).toBe(
        before.replace('|+\n      old\n\n\n', '|\n      a\n      b\n'),
      );
    });

    it('replaces the value on the next line where it stands', () => {
      const before = fileOf(LAYOUTS['value on the next line']!.lines);

      expect(textOf(withStages(before, VIEW, asking('new')))).toBe(
        before.replace('prompt:\n      old', 'prompt:\n      new'),
      );
      expect(textOf(withStages(before, VIEW, asking('a\nb')))).toBe(
        before.replace(
          'prompt:\n      old',
          'prompt:\n      |-\n      a\n      b',
        ),
      );
    });

    it('keeps the comment after a value it replaces', () => {
      const before = fileOf(
        LAYOUTS['comments before, inside and after']!.lines,
      );

      expect(textOf(withStages(before, VIEW, asking('new')))).toBe(
        before.replace('prompt: old # the prompt', 'prompt: new # the prompt'),
      );
    });

    it('returns the input byte for byte when no prompt is asked for', () => {
      for (const { lines } of Object.values(LAYOUTS)) {
        const before = fileOf(lines);
        expect(textOf(withStages(before, VIEW, VIEW.stages))).toBe(before);
      }
    });

    it('leaves an unchanged block scalar as it is, byte for byte', () => {
      for (const { lines, old } of Object.values(LAYOUTS)) {
        const before = fileOf(lines);
        expect(textOf(withStages(before, VIEW, asking(old)))).toBe(before);
      }
    });

    it('removes the key and its lines for the empty text', () => {
      const before = fileOf(LAYOUTS.literal!.lines);

      expect(textOf(withStages(before, VIEW, asking('')))).toBe(
        before.replace('    prompt: |\n      old\n      text\n', ''),
      );
    });

    it('removes a key that is on the line of the dash with the dash kept', () => {
      const before = fileOf(LAYOUTS['key first, after the dash']!.lines);

      expect(textOf(withStages(before, VIEW, asking('')))).toBe(
        before.replace('  - prompt: old\n    name: middle', '  - name: middle'),
      );
    });

    it('adds a prompt after the last key, before the comments of the next stage', () => {
      const before = fileOf(
        NO_KEY['no prompt key, comments before, inside and after']!,
      );

      expect(textOf(withStages(before, VIEW, asking('New text.')))).toBe(
        before.replace(
          '    agent: k-architect # the agent\n',
          '    agent: k-architect # the agent\n    prompt: New text.\n',
        ),
      );
    });

    it('adds a block prompt with the indent of the keys of the stage', () => {
      const before = fileOf(NO_KEY['no prompt key']!);

      expect(textOf(withStages(before, VIEW, asking('a\nb\n')))).toBe(
        before.replace(
          '    agent: k-architect\n',
          '    agent: k-architect\n    prompt: |\n      a\n      b\n',
        ),
      );
    });

    it('adds a prompt to a stage at the end of a file with no final line break', () => {
      const lines = ['  - name: middle', '    agent: k-architect'];
      const before = [...HEAD, ...BEFORE, ...lines].join('\n');
      const view: WorkflowView = { ...VIEW, stages: [FIRST, MIDDLE] };

      const after = textOf(
        withStages(before, view, [
          { ...FIRST, from: 0 },
          { ...MIDDLE, from: 1, prompt: 'a\nb' },
        ]),
      );

      expect(after).toBe(`${before}\n    prompt: |-\n      a\n      b`);
    });

    it('adds a prompt to a new stage, and sets it on a stage that moved', () => {
      const before = fileOf(NO_KEY['no prompt key']!);
      const stages: StageToWrite[] = [
        { name: 'new', agent: 'k-tpm', prompt: 'Hello.' },
        { ...LAST, from: 2, prompt: 'Moved.' },
        { ...FIRST, from: 0 },
      ];

      const after = read(textOf(withStages(before, VIEW, stages)));

      expect(after.stages.map((s) => [s.name, s.prompt])).toEqual([
        ['new', 'Hello.'],
        ['last', 'Moved.'],
        ['first', read(before).stages[0]?.prompt],
      ]);
    });

    it('writes the prompts of two stages in one save', () => {
      const before = fileOf(LAYOUTS.plain!.lines);
      const stages: StageToWrite[] = [
        { ...FIRST, from: 0, prompt: 'One\ntwo' },
        { ...MIDDLE, from: 1, prompt: '' },
        { ...LAST, from: 2, prompt: 'Three.' },
      ];

      const after = read(textOf(withStages(before, VIEW, stages)));

      expect(after.stages.map((s) => s.prompt)).toEqual([
        'One\ntwo',
        undefined,
        'Three.',
      ]);
    });
  });

  describe('a save that edits one prompt', () => {
    const FILE = [
      '# Plans and builds.',
      'format: konductor/1 # the only format',
      'name: hello',
      'version: 0.1.0',
      'intent:',
      '  # what must be true at the end',
      '  outcome: Say hi',
      'params:',
      '  goal:',
      '    default: Say hi',
      'stages: # in run order',
      '  # plans',
      '  - name: plan # the first stage',
      '    # who plans',
      '    agent: k-architect   # a shipped agent',
      '    prompt: >-   # what to do',
      '      Write the plan.',
      '      # kept line',
      '',
      '  # builds',
      '  - name: build',
      '    agent: k-developer',
      '    prompt: |+',
      '      Build it.',
      '',
      '',
      '# the end',
      '',
    ].join('\n');
    const view: WorkflowView = {
      name: 'hello',
      intent: { outcome: 'Say hi' },
      stages: [
        { name: 'plan', agent: 'k-architect' },
        { name: 'build', agent: 'k-developer' },
      ],
    };
    const keep: StageToWrite[] = view.stages.map((s, from) => ({ ...s, from }));

    it('returns the input byte for byte when nothing is edited', () => {
      expect(textOf(withStages(FILE, view, keep))).toBe(FILE);
    });

    it('changes no byte outside the span of the first value', () => {
      const span =
        '>-   # what to do\n      Write the plan.\n      # kept line\n';
      const start = FILE.indexOf(span);

      const after = textOf(
        withStages(FILE, view, [
          { ...keep[0]!, prompt: 'Write it down.' },
          keep[1]!,
        ]),
      );

      expect(after).toBe(
        FILE.slice(0, start) +
          '>-   # what to do\n      Write it down.\n' +
          FILE.slice(start + span.length),
      );
    });

    it('changes no byte outside the span of the second value', () => {
      const span = '|+\n      Build it.\n\n\n';
      const start = FILE.indexOf(span);

      const after = textOf(
        withStages(FILE, view, [
          keep[0]!,
          { ...keep[1]!, prompt: 'Build\nit now' },
        ]),
      );

      expect(after).toBe(
        FILE.slice(0, start) +
          '|-\n      Build\n      it now\n' +
          FILE.slice(start + span.length),
      );
    });
  });

  describe('the layouts it refuses', () => {
    const plain = fileOf(LAYOUTS.plain!.lines);

    it('refuses to remove the prompt of a flow item, and says why', () => {
      const flow = fileOf(LAYOUTS['flow item']!.lines);
      const written = withStages(flow, VIEW, asking(''));

      expect(written).toMatchObject({ ok: false });
      expect(!written.ok && written.reason).toContain('flow form');
    });

    it('refuses to add a prompt to a flow item', () => {
      const flow = fileOf(['  - {name: middle, agent: k-architect}']);

      expect(withStages(flow, VIEW, asking('x')).ok).toBe(false);
    });

    it('refuses a file with mixed line endings', () => {
      const mixed = plain.replace(
        '    agent: k-architect\n',
        '    agent: k-architect\r\n',
      );
      const written = withStages(mixed, VIEW, asking('new'));

      expect(written.ok).toBe(false);
      expect(!written.ok && written.reason).toContain('mixes line endings');
    });

    it('refuses a prompt edit in a file whose only line breaks are carriage returns', () => {
      const cr = plain.replaceAll('\n', '\r');

      expect(withStages(cr, VIEW, asking('new')).ok).toBe(false);
    });

    it('still saves a name or agent change in a file with mixed line endings', () => {
      const mixed = plain.replace(
        '    agent: k-architect\n',
        '    agent: k-architect\r\n',
      );
      const stages = asking(undefined).map((s, i) =>
        i === 1 ? { ...s, agent: 'k-tpm' } : s,
      );

      expect(textOf(withStages(mixed, VIEW, stages))).toBe(
        mixed.replace('k-architect', 'k-tpm'),
      );
    });

    it('refuses a prompt edit when the file does not read as YAML', () => {
      const broken = plain.replace('name: hello', 'name: [hello');
      const written = withStages(broken, VIEW, asking('new'));

      expect(written.ok).toBe(false);
      expect(!written.ok && written.reason).toContain(
        'where the prompts of this file are',
      );
    });

    it('refuses to give a stage that reads a file a prompt of its own', () => {
      const file = fileOf([
        '  - name: middle',
        '    agent: k-architect',
        '    prompt_file: m.md',
      ]);

      expect(withStages(file, VIEW, asking('x'))).toEqual({
        ok: false,
        reason: 'This stage reads its prompt from a file.',
      });
      expect(textOf(withStages(file, VIEW, asking('')))).toBe(file);
    });

    it('does not pick between a prompt and a prompt_file', () => {
      const both = fileOf([
        '  - name: middle',
        '    agent: k-architect',
        '    prompt: a',
        '    prompt_file: m.md',
      ]);
      const written = withStages(both, VIEW, asking('b'));

      expect(written.ok).toBe(false);
      expect(!written.ok && written.reason).toContain(
        'both `prompt` and `prompt_file`',
      );
      expect(textOf(withStages(both, VIEW, asking('a')))).toBe(both);
    });

    it.each([
      ['an alias', '    prompt: *a'],
      ['a tag', '    prompt: !!str a'],
      ['a number', '    prompt: 12'],
      ['a list', '    prompt: [a, b]'],
    ])('refuses to change a prompt that is %s', (_, line) => {
      const odd = fileOf(['  - name: middle', '    agent: k-architect', line]);

      expect(withStages(odd, VIEW, asking('b')).ok).toBe(false);
    });

    it('refuses to remove the only key after the dash', () => {
      const only = fileOf(['  - prompt: old']);
      const written = withStages(only, VIEW, asking(''));

      expect(written.ok).toBe(false);
    });
  });

  describe('a prompt next to a change of the stages', () => {
    it('keeps the prompt of a stage that is renamed and given another agent', () => {
      const before = fileOf(LAYOUTS.literal!.lines);
      const stages = asking(undefined).map((s, i) =>
        i === 1 ? { ...s, name: 'renamed', agent: 'k-tpm' } : s,
      );

      const after = read(textOf(withStages(before, VIEW, stages)));

      expect(after.stages[1]).toEqual({
        name: 'renamed',
        agent: 'k-tpm',
        prompt: 'old\ntext\n',
      });
    });
  });
});
