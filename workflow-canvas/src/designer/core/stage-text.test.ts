// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { StageView, WorkflowView } from '../../api/types';
import {
  inPlaceBlocker,
  withStages,
  type StageToWrite,
  type Written,
} from './stage-text';

function viewOf(...stages: StageView[]): WorkflowView {
  return { name: 'hello', intent: { outcome: 'Say hi' }, stages };
}

// The stages of the view, each in its own place: a draft with no change.
function kept(view: WorkflowView): StageToWrite[] {
  return view.stages.map((stage, from) => ({ ...stage, from }));
}

// The stages of the view with one of them changed in place.
function change(
  view: WorkflowView,
  at: number,
  edit: Partial<StageView>,
): StageToWrite[] {
  return kept(view).map((stage, i) =>
    i === at ? { ...stage, ...edit } : stage,
  );
}

function textOf(written: Written): string {
  if (!written.ok) throw new Error(`The writer refused: ${written.reason}`);
  return written.text;
}

function reasonOf(written: Written): string {
  if (written.ok) throw new Error('The writer wrote the change.');
  return written.reason;
}

const write = (...args: Parameters<typeof withStages>) =>
  textOf(withStages(...args));
const refuse = (...args: Parameters<typeof withStages>) =>
  reasonOf(withStages(...args));

const DRAFT = { name: 'draft', agent: 'k-developer' };
const REVIEW = { name: 'review', agent: 'k-quality-assurance' };
const VIEW = viewOf(DRAFT, REVIEW);

// Every key of slice 1, with comments before, after and inside keys.
const FIRST_RELEASE = [
  '# Greets the reader.',
  'format: konductor/1 # the only format',
  'name: hello',
  'version: 0.1.0',
  'intent:',
  '  # what must be true at the end',
  '  outcome: Add a greeting to the README',
  '  accept:',
  '    - id: readme-exists',
  '      file: README.md # checked after the run',
  'params:',
  '  goal:',
  '    description: What the workflow should accomplish.',
  '    default: Add a greeting to the README',
  '',
  'stages: # in run order',
  '  # writes the greeting',
  '  - name: draft # the first stage',
  '    # the agent that writes',
  '    agent: k-developer   # one of the shipped agents',
  '    prompt: >-',
  '      Write the greeting to README.md.',
  '      # This line is part of the prompt.',
  '  - name: "review"',
  "    agent: 'k-quality-assurance'",
  '    prompt_file: prompts/review.md',
  '',
  '# after the stages',
  '',
].join('\n');

const TEXT = [
  'format: konductor/1',
  'name: hello',
  'version: 0.1.0',
  'intent:',
  '  outcome: Add a greeting to the README',
  'stages:',
  '  - name: draft',
  '    agent: k-developer',
  '    prompt: Write the greeting to README.md.',
  '  - name: review',
  '    agent: k-quality-assurance',
  '    prompt_file: review.md',
  '',
].join('\n');

describe('withStages, the round trip of a save', () => {
  it('returns the input byte for byte for a save with no edit', () => {
    expect(write(FIRST_RELEASE, VIEW, kept(VIEW))).toBe(FIRST_RELEASE);
    expect(write(FIRST_RELEASE, VIEW, [DRAFT, REVIEW])).toBe(FIRST_RELEASE);
  });

  it.each([
    ['the name of the first stage', 0, 'name', 'draft', 'write'],
    ['the agent of the first stage', 0, 'agent', 'k-developer', 'k-architect'],
    ['the name of the second stage', 1, 'name', '"review"', 'check'],
    [
      'the agent of the second stage',
      1,
      'agent',
      "'k-quality-assurance'",
      'k-tpm',
    ],
  ] as const)(
    'changes no byte outside the value for an edit of %s',
    (_, at, key, raw, value) => {
      const marker = at === 0 ? '  - name: draft' : '  - name: "review"';
      const start = FIRST_RELEASE.indexOf(
        `${key}: ${raw}`,
        FIRST_RELEASE.indexOf(marker),
      );
      const from = start + key.length + 2;

      const next = write(
        FIRST_RELEASE,
        VIEW,
        change(VIEW, at, { [key]: value }),
      );

      expect(next).toBe(
        FIRST_RELEASE.slice(0, from) +
          value +
          FIRST_RELEASE.slice(from + raw.length),
      );
    },
  );

  it('changes no byte outside the two values when a stage gets a new name and agent', () => {
    const next = write(
      FIRST_RELEASE,
      VIEW,
      change(VIEW, 0, { name: 'write', agent: 'k-architect' }),
    );

    expect(next).toBe(
      FIRST_RELEASE.replace('name: draft #', 'name: write #').replace(
        'agent: k-developer ',
        'agent: k-architect ',
      ),
    );
  });

  it('keeps the CRLF line endings of a file it edits', () => {
    const text = FIRST_RELEASE.replaceAll('\n', '\r\n');

    const next = write(text, VIEW, change(VIEW, 1, { agent: 'k-tpm' }));

    expect(next).toBe(text.replace("'k-quality-assurance'", 'k-tpm'));
  });
});

describe('withStages', () => {
  it('changes an agent and keeps the prompt of the stage', () => {
    const next = write(TEXT, VIEW, change(VIEW, 0, { agent: 'k-architect' }));

    expect(next).toBe(TEXT.replace('k-developer', 'k-architect'));
  });

  it('renames a stage and keeps its prompt_file', () => {
    const next = write(TEXT, VIEW, change(VIEW, 1, { name: 'check' }));

    expect(next).toBe(TEXT.replace('name: review', 'name: check'));
  });

  it('writes the same text back when the stages are the same', () => {
    expect(write(TEXT, VIEW, [DRAFT, REVIEW])).toBe(TEXT);
  });

  it('keeps the keys, comments and blank lines around the stages', () => {
    const text =
      '# Greets\nformat: konductor/1\nversion: 0.1.0\nname: hello\nintent:\n  outcome: Say hi\n\nstages: # in order\n  # first\n  - name: a\n    agent: k-developer\n\n# the end\n';

    const next = write(text, viewOf({ name: 'a', agent: 'k-developer' }), [
      { name: 'a', agent: 'k-developer', from: 0 },
      { name: 'b', agent: 'k-tpm' },
    ]);

    expect(next).toBe(
      '# Greets\nformat: konductor/1\nversion: 0.1.0\nname: hello\nintent:\n  outcome: Say hi\n\nstages: # in order\n  # first\n  - name: a\n    agent: k-developer\n  - name: b\n    agent: k-tpm\n\n# the end\n',
    );
  });

  it('keeps a key that comes after the stages', () => {
    const text =
      'name: hello\nstages:\n- name: a\n  agent: k-developer\nintent:\n  outcome: Say hi\n';
    const view = viewOf({ name: 'a', agent: 'k-developer' });

    const next = write(text, view, [{ name: 'b', agent: 'k-tpm', from: 0 }]);

    expect(next).toBe(
      'name: hello\nstages:\n- name: b\n  agent: k-tpm\nintent:\n  outcome: Say hi\n',
    );
  });

  it('stops the block at a document marker', () => {
    const text =
      'name: hello\nstages:\n  - name: a\n    agent: k-tpm\n---\nx: 1\n';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const next = write(text, view, [{ name: 'b', agent: 'k-tpm', from: 0 }]);

    expect(next).toBe(
      'name: hello\nstages:\n  - name: b\n    agent: k-tpm\n---\nx: 1\n',
    );
  });

  it('adds no line break at the end of a file that has none', () => {
    const text = 'name: hello\nstages:\n  - name: a\n    agent: k-tpm';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const next = write(text, view, change(view, 0, { agent: 'k-architect' }));

    expect(next).toBe(
      'name: hello\nstages:\n  - name: a\n    agent: k-architect',
    );
  });

  it('keeps a file in CRLF line endings', () => {
    const text = TEXT.replaceAll('\n', '\r\n');

    const next = write(text, VIEW, [{ ...REVIEW, from: 1 }]);

    expect(next).toBe(
      'format: konductor/1\r\nname: hello\r\nversion: 0.1.0\r\nintent:\r\n  outcome: Add a greeting to the README\r\nstages:\r\n  - name: review\r\n    agent: k-quality-assurance\r\n    prompt_file: review.md\r\n',
    );
  });

  it('keeps a comment and a key after the stages of a CRLF file', () => {
    const text =
      'name: hello\r\nstages:\r\n  - name: a\r\n    agent: k-tpm\r\n# note\r\nversion: 0.1.0\r\n';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const next = write(text, view, [REVIEW]);

    expect(next).toBe(
      'name: hello\r\nstages:\r\n  - name: review\r\n    agent: k-quality-assurance\r\n# note\r\nversion: 0.1.0\r\n',
    );
  });

  it('adds no stray carriage return to a CRLF file that ends without a line break', () => {
    const text = 'name: hello\r\nstages:\r\n  - name: a\r\n    agent: k-tpm';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const next = write(text, view, [REVIEW]);

    expect(next).toBe(
      'name: hello\r\nstages:\r\n  - name: review\r\n    agent: k-quality-assurance',
    );
  });

  it('writes a name that is not plain text in double quotes', () => {
    const next = write(TEXT, VIEW, [
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

  it('writes an edited value that is not plain text in double quotes, in place', () => {
    const next = write(TEXT, VIEW, change(VIEW, 0, { name: 'yes' }));

    expect(next).toBe(TEXT.replace('name: draft', 'name: "yes"'));
  });

  it('takes the item of a deleted stage that a new stage matches exactly', () => {
    const next = write(TEXT, VIEW, [{ ...DRAFT, from: 0 }, REVIEW]);

    expect(next).toBe(TEXT);
  });

  it('keeps a line of a block scalar that looks like a comment with its stage', () => {
    const view = viewOf(DRAFT, REVIEW);

    const next = write(FIRST_RELEASE, view, [{ ...DRAFT, from: 0 }]);

    expect(next).toContain(
      '      Write the greeting to README.md.\n      # This line is part of the prompt.\n\n# after the stages\n',
    );
    expect(next).not.toContain('review');
  });

  it('keeps the trailing blank lines of a block scalar that keeps them, when the next stage is deleted', () => {
    const text =
      'stages:\n  - name: a\n    agent: x\n    prompt: |+\n      Hello.\n\n  - name: b\n    agent: y\n';
    const view = viewOf({ name: 'a', agent: 'x' }, { name: 'b', agent: 'y' });

    const next = write(text, view, [{ name: 'a', agent: 'x', from: 0 }]);

    expect(next).toBe(
      'stages:\n  - name: a\n    agent: x\n    prompt: |+\n      Hello.\n\n',
    );
  });
});

describe('withStages, the layouts it refuses to edit in place', () => {
  it('refuses a flow list of stages on the key line, and says why', () => {
    const text =
      'name: hello\nintent:\n  outcome: Say hi\nstages: [{name: a, agent: k-tpm}]\n';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const reason = refuse(text, view, [{ name: 'b', agent: 'k-architect' }]);

    expect(reason).toContain(
      'are written in brackets, as in `stages: [...]`, or not under a top-level `stages:` key',
    );
  });

  it('refuses a flow list of stages on the line below the key', () => {
    const text = 'stages:\n  [{name: a, agent: k-tpm}]\n';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const reason = refuse(text, view, change(view, 0, { agent: 'x' }));

    expect(reason).toContain('written in brackets');
  });

  it('refuses a file that has no stages key of the block form', () => {
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    expect(refuse('name: a\n', view, [{ name: 'b', agent: 'x' }])).toContain(
      'written in brackets',
    );
  });

  it('refuses when the items do not match the stages of the view', () => {
    const reason = refuse(TEXT, viewOf(DRAFT), [
      { ...DRAFT, from: 0 },
      { name: 'b', agent: 'y' },
    ]);

    expect(reason).toContain(
      'cannot tell where each stage of this file starts',
    );
  });

  it('refuses a change of a stage written as a flow mapping, and names it', () => {
    const text =
      'stages:\n  - {name: a, agent: x}\n  - name: b\n    agent: y\n';
    const view = viewOf({ name: 'a', agent: 'x' }, { name: 'b', agent: 'y' });

    const reason = refuse(text, view, change(view, 0, { agent: 'z' }));

    expect(reason).toContain(
      'The stage `a` is not written with one key to a line',
    );
  });

  it('writes a change of another stage next to a stage written as a flow mapping', () => {
    const text =
      'stages:\n  - {name: a, agent: x}\n  - name: b\n    agent: y\n';
    const view = viewOf({ name: 'a', agent: 'x' }, { name: 'b', agent: 'y' });

    expect(write(text, view, change(view, 1, { agent: 'z' }))).toBe(
      text.replace('agent: y', 'agent: z'),
    );
  });

  it.each([
    ['on the next line', '    agent:\n      k-developer\n'],
    ['in a block scalar', '    agent: >-\n      k-developer\n'],
    ['with a tag', '    agent: !!str k-developer\n'],
    ['with an anchor', '    agent: &who k-developer\n'],
    [
      'in quotes that close on a later line',
      '    agent: "k-\n      developer"\n',
    ],
    [
      'with an escape that JSON does not read',
      '    agent: "k\\x2ddeveloper"\n',
    ],
    [
      'as a plain value that goes on to the next line',
      '    agent: k-developer\n      more\n',
    ],
  ])('refuses a change of a value written %s', (_, agent) => {
    const text = `stages:\n  - name: draft\n${agent}`;
    const view = viewOf(DRAFT);

    const reason = refuse(text, view, change(view, 0, { agent: 'k-tpm' }));

    expect(reason).toContain(
      'The `agent` of the stage `draft` is not one value on the line of its key',
    );
  });

  it('refuses a change of a value that does not read as the view says', () => {
    const view = viewOf({ name: 'draft', agent: 'k-architect' });

    const reason = refuse(
      'stages:\n  - name: draft\n    agent: k-developer\n',
      view,
      change(view, 0, { agent: 'k-tpm' }),
    );

    expect(reason).toContain('The `agent` of the stage `draft`');
  });

  it('refuses a change of a key that the item does not have', () => {
    const view = viewOf(DRAFT);

    const reason = refuse(
      'stages:\n  - name: draft\n',
      view,
      change(view, 0, { agent: 'k-tpm' }),
    );

    expect(reason).toContain('The `agent` of the stage `draft`');
  });

  it('writes the same text back for no edit, even for a layout it refuses', () => {
    const text = 'stages: [{name: a, agent: k-tpm}]\n';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    expect(write(text, view, kept(view))).toBe(text);
  });
});

describe('inPlaceBlocker', () => {
  const ONE = viewOf({ name: 'a', agent: 'x' });

  it('is undefined for stages in the block form', () => {
    expect(inPlaceBlocker(TEXT, VIEW)).toBeUndefined();
  });

  it('is undefined when a comment follows the key', () => {
    expect(
      inPlaceBlocker(
        'name: a\nstages: # run in order\n  - name: a\n    agent: x\n',
        ONE,
      ),
    ).toBeUndefined();
  });

  it('gives the reason for stages in the flow form', () => {
    expect(
      inPlaceBlocker('stages: [{name: a, agent: k-tpm}]\n', ONE),
    ).toContain('written in brackets');
  });

  it('gives the reason when the text has no stages key', () => {
    expect(inPlaceBlocker('name: a\n', ONE)).toContain('written in brackets');
  });

  it('agrees with what withStages does', () => {
    const text =
      'name: hello\n# kept\nstages:\n  - name: a\n    agent: k-tpm\n';
    const view = viewOf({ name: 'a', agent: 'k-tpm' });

    const next = write(text, view, change(view, 0, { name: 'b' }));

    expect(inPlaceBlocker(text, view)).toBeUndefined();
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
  ])('lets the stages be edited in place for %s', (_, text) => {
    expect(inPlaceBlocker(text, ONE)).toBeUndefined();
  });
});

const COMMENTED = [
  '# about the workflow',
  'name: wf',
  'intent:',
  '  outcome: Say hi',
  'stages:',
  '  # the first one',
  '  - {name: a, agent: x} # flow style',
  '',
  '  # the second one',
  '  - agent: y',
  "    name: 'b'",
  '  - name: c',
  '    # inside c',
  '    agent: z',
  '  # about the end',
  '# footer',
  '',
].join('\n');
const COMMENTED_VIEW = viewOf(
  { name: 'a', agent: 'x' },
  { name: 'b', agent: 'y' },
  { name: 'c', agent: 'z' },
);

describe('withStages, on a file with comments in the block', () => {
  const [A, B, C] = kept(COMMENTED_VIEW);

  it('keeps the lines and comments of the stages that are unchanged', () => {
    const next = write(COMMENTED, COMMENTED_VIEW, [
      A!,
      B!,
      { ...C!, agent: 'w' },
    ]);

    expect(next).toBe(COMMENTED.replace('agent: z', 'agent: w'));
  });

  it('keeps the comments inside a stage that is changed', () => {
    const next = write(COMMENTED, COMMENTED_VIEW, [
      A!,
      { ...B!, name: 'bb' },
      C!,
    ]);

    expect(next).toBe(COMMENTED.replace("name: 'b'", 'name: bb'));
  });

  it('takes the comments in front of a deleted stage along with it', () => {
    const next = write(COMMENTED, COMMENTED_VIEW, [A!, C!]);

    expect(next).not.toContain('the second one');
    expect(next).toContain('the first one');
    expect(next).toContain('flow style');
    expect(next).toContain('# inside c');
    expect(next).toContain('  # about the end\n# footer\n');
  });

  it('keeps every comment and blank line after the last stage, indented or not', () => {
    const next = write(COMMENTED, COMMENTED_VIEW, [A!]);

    expect(next.endsWith('  # about the end\n# footer\n')).toBe(true);
  });

  it('moves the lines of a stage that moved, with its comments', () => {
    const next = write(COMMENTED, COMMENTED_VIEW, [B!, A!, C!]);

    expect(next.indexOf('the second one')).toBeLessThan(
      next.indexOf("name: 'b'"),
    );
    expect(next.indexOf("name: 'b'")).toBeLessThan(next.indexOf('flow style'));
  });

  it('writes a new stage in the plain layout after the others', () => {
    const next = write(COMMENTED, COMMENTED_VIEW, [
      A!,
      B!,
      C!,
      { name: 'd', agent: 'v' },
    ]);

    expect(next).toContain(
      '    agent: z\n  - name: d\n    agent: v\n  # about the end\n',
    );
  });

  it('refuses when the items do not match the view', () => {
    const reason = refuse(COMMENTED, viewOf({ name: 'a', agent: 'x' }), [
      { name: 'a', agent: 'x', from: 0 },
      { name: 'b', agent: 'y' },
    ]);

    expect(reason).toContain('cannot tell where each stage');
  });
});

describe('withStages, on line endings', () => {
  const ONE = viewOf({ name: 'a', agent: 'x' });

  it('uses the line ending of the stages line in a file with mixed endings', () => {
    const text =
      'name: wf\nintent: x\n# c\r\nstages:\n  - name: a\n    agent: x\n';

    const next = write(text, ONE, [
      { name: 'a', agent: 'x', from: 0 },
      { name: 'b', agent: 'k-tpm' },
    ]);

    expect(next).toBe(`${text}  - name: b\n    agent: k-tpm\n`);
  });

  it('keeps the line ending of a kept last stage in a file with mixed endings', () => {
    const text =
      'name: wf\nintent: x\r\nstages:\n  - name: a\n    agent: x\n  - name: b\r\n    agent: y\r\n# end\n';
    const view = viewOf({ name: 'a', agent: 'x' }, { name: 'b', agent: 'y' });

    const next = write(text, view, change(view, 0, { agent: 'z' }));

    expect(next).toBe(text.replace('agent: x', 'agent: z'));
    expect(write(text, view, kept(view))).toBe(text);
  });

  it('keeps a file of lone CR as it is, and writes new lines with CR', () => {
    const text = 'name: wf\rintent: x\rstages:\r  - name: a\r    agent: x\r';

    const next = write(text, ONE, [
      { name: 'a', agent: 'x', from: 0 },
      { name: 'b', agent: 'k-tpm' },
    ]);

    expect(next).toBe(`${text}  - name: b\r    agent: k-tpm\r`);
  });

  it('keeps a BOM in front of the stages key', () => {
    const text = '\uFEFFstages:\n  - name: a\n    agent: x\n';

    const next = write(text, ONE, change(ONE, 0, { agent: 'k-tpm' }));

    expect(next).toBe('\uFEFFstages:\n  - name: a\n    agent: k-tpm\n');
  });

  it('writes into a block under a quoted key', () => {
    const text = 'name: wf\n"stages":\n  - name: a\n    agent: x\n';

    const next = write(text, ONE, change(ONE, 0, { agent: 'k-tpm' }));

    expect(next).toBe('name: wf\n"stages":\n  - name: a\n    agent: k-tpm\n');
  });
});

describe('withStages, on words that YAML 1.1 reads as booleans', () => {
  it.each(['y', 'n', 'yes', 'no', 'on', 'off', 'Yes', 'OFF'])(
    'quotes the name %s',
    (name) => {
      const view = viewOf({ name: 'a', agent: 'x' });

      const next = write(
        'name: wf\nstages:\n  - name: a\n    agent: x\n',
        view,
        change(view, 0, { name }),
      );

      expect(next).toContain(`- name: "${name}"`);
    },
  );
});
