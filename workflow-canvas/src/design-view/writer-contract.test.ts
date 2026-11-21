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
import { writerKeepsStage } from './stage-item';

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

/**
 * The file as it would read if the writer had changed nothing but the name on
 * the line the stage starts at. The writer keeps the lines of a stage exactly
 * when what it writes is this.
 */
function onlyTheNameChanged(text: string, line: number): string {
  const lines = text.split('\n');
  const at = lines[line - 1] ?? '';
  lines[line - 1] = at.replace(/- name: .*$/, `- name: ${NEW_NAME}`);
  return lines.join('\n');
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
  const lines = text.split('\n');
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

const HEAD = `format: konductor/1
name: hello
intent:
  outcome: Add a greeting to the README
stages:
`;

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
