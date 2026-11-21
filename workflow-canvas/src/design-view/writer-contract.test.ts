// SPDX-License-Identifier: Apache-2.0
/**
 * The contract between the stage writer of the editor and the reader that
 * says whether a save would keep the lines of a stage.
 *
 * `writerKeepsStage` carries its own model of what the writer writes and of
 * where one item of the list ends, so it can drift from the writer it speaks
 * for. These tests run real edits through `withStages` and hold the two to
 * the same answer: the reader says a stage is kept exactly when the writer
 * leaves every line of the file but the value that was edited.
 */
import { describe, expect, it } from 'vitest';
import type { StageView, WorkflowView } from '../api/types';
import type { CheckViewStage } from '../designer-view/yaml-draft';
import { withStages } from '../designer/core/stage-text';
import { writerKeepsStage, writerScalar } from './stage-item';

const VIEW: WorkflowView = {
  name: 'hello',
  intent: { outcome: 'Add a greeting to the README' },
  stages: [
    { name: 'draft', agent: 'k-developer' },
    { name: 'review', agent: 'k-quality-assurance' },
  ],
};

const NEW_NAME = 'drafting';

/** The stages of the file with the stage at `index` renamed. */
function renamed(stages: readonly StageView[], index: number): StageView[] {
  return stages.map((stage, at) =>
    at === index ? { ...stage, name: NEW_NAME } : { ...stage },
  );
}

/** One line of a file and the break that ends it, empty at the end of one. */
interface Line {
  text: string;
  eol: string;
}

// The lines of a text with their breaks kept, so a file written with any mix
// of `\r\n`, `\n` and a lone `\r` can be taken apart and put back byte for
// byte.
function brokenLinesOf(text: string): Line[] {
  const lines: Line[] = [];
  let end = 0;
  for (const match of text.matchAll(/([^\r\n]*)(\r\n|\r|\n)/g)) {
    lines.push({ text: match[1] ?? '', eol: match[2] ?? '' });
    end = match.index + match[0].length;
  }
  if (end < text.length) lines.push({ text: text.slice(end), eol: '' });
  return lines;
}

const joined = (lines: readonly Line[]) =>
  lines.map((line) => line.text + line.eol).join('');

/**
 * The file as it would read if the writer had changed nothing but the name on
 * the line the stage starts at. The writer keeps the lines of a stage exactly
 * when what it writes is this, the break of every line included.
 */
function onlyTheNameChanged(text: string, line: number): string {
  const lines = brokenLinesOf(text);
  const at = lines[line - 1];
  if (at) at.text = at.text.replace(/- name: .*$/, `- name: ${NEW_NAME}`);
  return joined(lines);
}

// A scalar as a parser reads it: the value, without the quotes a file may
// write around it. A check answer gives the value, never the YAML.
const scalarOf = (value: string) =>
  /^(["'])(.*)\1$/.exec(value.trim())?.[2] ?? value.trim();

/**
 * The stages of the text as a check gives them: the value of each key, and
 * the lines the stage takes up, with the blank lines and comments that trail
 * it left out, as a parser's range is.
 */
function checkStagesOf(text: string): CheckViewStage[] {
  const lines = brokenLinesOf(text).map((line) => line.text);
  const starts = lines.flatMap((line, index) =>
    /^[ \t]*- /.test(line) ? [index] : [],
  );
  return starts.map((start, nth) => {
    let end = (starts[nth + 1] ?? lines.length) - 1;
    while (end > start && /^\s*(#.*)?$/.test(lines[end] ?? '')) end -= 1;
    const item = lines.slice(start, end + 1).join('\n');
    const keyed = (key: string) =>
      new RegExp(`[-{,]?\\s*${key}: *([^,}\\n]+)`).exec(item)?.[1];
    return {
      name: scalarOf(keyed('name') ?? ''),
      agent: scalarOf(keyed('agent') ?? ''),
      range: { line: start + 1, end_line: end + 1 },
    };
  });
}

/** What the writer did and what the reader said about it. */
function bothOn(text: string, index: number) {
  const stages = checkStagesOf(text);
  const written = withStages(text, VIEW, renamed(VIEW.stages, index));
  const line = (stages[index]?.range as { line: number }).line;
  return {
    writerKept: written === onlyTheNameChanged(text, line),
    readerSaid: writerKeepsStage(text, stages, index),
    written,
  };
}

/** The workflow of a text, as the page holds it once a check has read it. */
function viewOf(text: string): WorkflowView {
  return {
    name: 'hello',
    intent: { outcome: 'Add a greeting to the README' },
    stages: checkStagesOf(text).map((stage) => ({
      name: String(stage.name),
      agent: String(stage.agent),
    })),
  };
}

/** One edit of one stage: the key that changes, and the value it takes. */
interface Edit {
  readonly key: 'name' | 'agent';
  /** Written plainly, so the file it is expected in holds it as it is. */
  readonly value: string;
}

/**
 * The file as it would read if the writer had changed nothing but that one
 * value, which the stage writes on the line the key is on: the name on the
 * line the stage starts at, the agent on the one below it.
 */
function onlyThatChanged(text: string, line: number, edit: Edit): string {
  const lines = brokenLinesOf(text);
  const at = lines[edit.key === 'name' ? line - 1 : line];
  if (at) {
    at.text = at.text.replace(
      new RegExp(`${edit.key}: .*$`),
      `${edit.key}: ${edit.value}`,
    );
  }
  return joined(lines);
}

/**
 * What the writer did and what the reader said about one edit of the stage at
 * `index`, for a file whose own stages say what the workflow holds.
 */
function bothOnEdit(text: string, index: number, edit: Edit) {
  const stages = checkStagesOf(text);
  const view = viewOf(text);
  const saved = view.stages.map((stage, at) =>
    at === index ? { ...stage, [edit.key]: edit.value } : { ...stage },
  );
  const written = withStages(text, view, saved);
  const line = (stages[index]?.range as { line: number }).line;
  return {
    writerKept: written === onlyThatChanged(text, line, edit),
    readerSaid: writerKeepsStage(text, stages, index),
    written,
  };
}

const HEAD = `format: konductor/1
name: hello
intent:
  outcome: Add a greeting to the README
stages:
`;

/**
 * The sample file with the breaks it is written with spelled out: `key` ends
 * every line down to `stages:`, `stage` the two lines of the first stage, and
 * `end` the last line of the file, which `''` leaves without one.
 */
function withBreaks(key: string, stage: string, end = key): string {
  return [
    `format: konductor/1${key}`,
    `name: hello${key}`,
    `intent:${key}`,
    `  outcome: Add a greeting to the README${key}`,
    `stages:${key}`,
    `  - name: draft${stage}`,
    `    agent: k-developer${stage}`,
    `  - name: review${key}`,
    `    agent: k-quality-assurance${end}`,
  ].join('');
}

describe('the stage writer and the reader of the lines it keeps', () => {
  it.each([
    [
      'a plain two-line item',
      `${HEAD}  - name: draft
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`,
      0,
    ],
    [
      'a comment in front of the first stage, which is the head of the list',
      `${HEAD}  # Writes the greeting.
  - name: draft
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`,
      0,
    ],
    [
      'a comment in front of a later stage',
      `${HEAD}  - name: draft
    agent: k-developer
  # Checks the greeting.
  - name: review
    agent: k-quality-assurance
`,
      1,
    ],
    [
      'a comment inside the stage',
      `${HEAD}  - name: draft
    # The one that writes it.
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`,
      0,
    ],
    [
      'a blank line inside the stage',
      `${HEAD}  - name: draft

    agent: k-developer
  - name: review
    agent: k-quality-assurance
`,
      0,
    ],
    [
      'a block scalar in the stage',
      `${HEAD}  - name: draft
    agent: k-developer
    prompt: |
      Write the greeting.
  - name: review
    agent: k-quality-assurance
`,
      0,
    ],
    [
      'an item in the flow form',
      `${HEAD}  - { name: draft, agent: k-developer }
  - name: review
    agent: k-quality-assurance
`,
      0,
    ],
    // The writer ends a line it writes again with the break of the `stages:`
    // key, so a file written throughout with one kind of break keeps its
    // bytes, and a stage whose breaks differ from that key does not.
    ['a file written throughout with CRLF', withBreaks('\r\n', '\r\n'), 0],
    [
      'a file written throughout with lone carriage returns',
      withBreaks('\r', '\r'),
      0,
    ],
    ['a CRLF key with a stage written with LF', withBreaks('\r\n', '\n'), 0],
    ['an LF key with a stage written with CRLF', withBreaks('\n', '\r\n'), 0],
    [
      'an LF key with a stage written with lone carriage returns',
      withBreaks('\n', '\r'),
      0,
    ],
    [
      'a file with no final break, editing a stage before its last line',
      withBreaks('\n', '\n', ''),
      0,
    ],
  ])('agree on %s', (_, text, index) => {
    const { writerKept, readerSaid } = bothOn(text, index);

    expect(readerSaid).toBe(writerKept);
  });

  it('says the writer keeps a plain item, so the save may go ahead', () => {
    const text = `${HEAD}  - name: draft
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`;

    const { writerKept, readerSaid } = bothOn(text, 0);

    // The case the agreement above must not be vacuous on.
    expect(writerKept).toBe(true);
    expect(readerSaid).toBe(true);
  });

  it('says the writer keeps a CRLF file, so the save may go ahead', () => {
    const { writerKept, readerSaid } = bothOn(withBreaks('\r\n', '\r\n'), 0);

    expect(writerKept).toBe(true);
    expect(readerSaid).toBe(true);
  });

  it('says the writer rewrites the breaks of a stage the key does not share', () => {
    const text = withBreaks('\r\n', '\n');

    const { writerKept, readerSaid, written } = bothOn(text, 0);

    // The lines of the edited stage come back ended the way the key is, so
    // bytes outside the name that was edited have changed.
    expect(written).toContain('- name: drafting\r\n');
    expect(writerKept).toBe(false);
    expect(readerSaid).toBe(false);
  });

  // The writer ends the last line of a file as it found it, so a file that
  // ends inside the stage being edited keeps its missing break. The reader
  // refuses that stage all the same: whether those two lines are still the
  // last of the file depends on the draft being saved, which it cannot see,
  // and a stage added at the end would move them.
  it('refuses a stage the file ends on, though the writer would keep it', () => {
    const { writerKept, readerSaid } = bothOn(withBreaks('\n', '\n', ''), 1);

    expect(writerKept).toBe(true);
    expect(readerSaid).toBe(false);
  });

  // YAML 1.1 reads each of these as a boolean, so the writer quotes them to
  // keep them text. A file that writes one of them plainly reads back the
  // same value, which is why it is there, and the writer still rewrites those
  // bytes when it writes the stage again.
  const AS_BOOLEANS = ['y', 'n', 'yes', 'no', 'on', 'off'];

  it.each(AS_BOOLEANS)(
    'refuses a stage whose name the file writes as the plain %s, which the writer quotes',
    (value) => {
      const text = `${HEAD}  - name: ${value}
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`;

      const { writerKept, readerSaid, written } = bothOnEdit(text, 0, {
        key: 'agent',
        value: 'k-architect',
      });

      expect(written).toContain(`- name: "${value}"`);
      expect(writerKept).toBe(false);
      expect(readerSaid).toBe(false);
    },
  );

  it.each(AS_BOOLEANS)(
    'refuses a stage whose agent the file writes as the plain %s, which the writer quotes',
    (value) => {
      const text = `${HEAD}  - name: draft
    agent: ${value}
  - name: review
    agent: k-quality-assurance
`;

      const { writerKept, readerSaid, written } = bothOnEdit(text, 0, {
        key: 'name',
        value: 'drafting',
      });

      expect(written).toContain(`agent: "${value}"`);
      expect(writerKept).toBe(false);
      expect(readerSaid).toBe(false);
    },
  );

  // `writerScalar` is a copy of the writer's own encoder, which the writer
  // does not export. These cases hold the copy to it value by value: what the
  // writer puts on the line it writes is what the copy says it will be.
  it.each([
    'draft',
    'k-developer',
    'two words',
    'with.dots_and-dashes',
    'y',
    'n',
    'yes',
    'no',
    'on',
    'off',
    'true',
    'false',
    'null',
    'YES',
    'Off',
    '12',
    '',
    ' leading space',
    'trailing space ',
    'has: a colon',
    '*star',
    '- dash',
    'grüßen',
  ])('writes the name %p as the writer writes it', (value) => {
    const text = `${HEAD}  - name: draft
    agent: k-developer
`;
    const view = viewOf(text);

    const written = withStages(text, view, [
      { name: value, agent: 'k-developer' },
    ]);

    expect(written).toContain(`  - name: ${writerScalar(value)}\n`);
  });

  it('writes the agent the same way', () => {
    const text = `${HEAD}  - name: draft
    agent: k-developer
`;
    const view = viewOf(text);

    const written = withStages(text, view, [{ name: 'draft', agent: 'off' }]);

    expect(written).toContain(`    agent: ${writerScalar('off')}\n`);
    expect(written).toContain('    agent: "off"\n');
  });

  it('says the writer drops a comment inside the stage, so the save is refused', () => {
    const text = `${HEAD}  - name: draft
    # The one that writes it.
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`;

    const { writerKept, readerSaid, written } = bothOn(text, 0);

    expect(written).not.toContain('# The one that writes it.');
    expect(writerKept).toBe(false);
    expect(readerSaid).toBe(false);
  });

  // The reader is stricter than the writer on a layout or two: a name in
  // quotes is the value being edited, so the writer does keep the rest of
  // that item, and the reader refuses it all the same. What it must never do
  // is let a save through that the writer would change, so every layout is
  // held to that, whether the reader allows it or not.
  it.each([
    [
      'a name in quotes',
      `${HEAD}  - name: "draft"
    agent: k-developer
  - name: review
    agent: k-quality-assurance
`,
    ],
    [
      'an agent in quotes',
      `${HEAD}  - name: draft
    agent: "k-developer"
  - name: review
    agent: k-quality-assurance
`,
    ],
    [
      'the two keys the other way round',
      `${HEAD}  - agent: k-developer
    name: draft
  - name: review
    agent: k-quality-assurance
`,
    ],
    [
      'a key the editor cannot write',
      `${HEAD}  - name: draft
    agent: k-developer
    prompt_file: draft.md
  - name: review
    agent: k-quality-assurance
`,
    ],
    [
      'the item at the indent of the key above it',
      `${HEAD}- name: draft
  agent: k-developer
- name: review
  agent: k-quality-assurance
`,
    ],
  ])('allows no save the writer would change, with %s', (_, text) => {
    const { writerKept, readerSaid } = bothOn(text, 0);

    if (readerSaid) expect(writerKept).toBe(true);
  });

  it('leaves the stage that was not edited alone, whatever its lines hold', () => {
    const text = `${HEAD}  - name: draft
    agent: k-developer
  - name: review
    # Checks the greeting.
    agent: k-quality-assurance
`;

    const { written, readerSaid } = bothOn(text, 0);

    // The writer keeps the lines of a stage it did not change, so the reader
    // is asked about the changed one only.
    expect(written).toContain('# Checks the greeting.');
    expect(readerSaid).toBe(true);
  });
});
