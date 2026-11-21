// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { CheckView, CheckViewStage } from '../designer-view/yaml-draft';
import {
  SAVABLE_KEYS,
  checkStageOf,
  droppedKeysOf,
  fieldValuesOf,
  markedStageOf,
  pickedStageOf,
  saveRefusal,
  sourceStageOf,
} from './view-stage';

const view: CheckView = {
  format: 'konductor/1',
  version: '0.1.0',
  name: 'hello',
  intent: { outcome: 'Add a greeting' },
  stages: [
    {
      name: 'draft',
      kind: 'agent',
      agent: 'k-developer',
      prompt: 'Write the greeting.',
      range: { line: 10, end_line: 12 },
    },
    {
      name: 'review',
      kind: 'agent',
      agent: 'k-quality-assurance',
      outputs: { note: 'NOTE.md' },
      range: { line: 13, end_line: 13 },
    },
  ],
};

const stageOf = (over: Record<string, unknown>) => ({
  name: 'draft',
  ...over,
});

describe('checkStageOf', () => {
  it('finds the stage by name', () => {
    expect(checkStageOf(view, 'review')?.agent).toBe('k-quality-assurance');
  });

  it('finds no stage that the view does not have', () => {
    expect(checkStageOf(view, 'wrap-up')).toBeUndefined();
  });

  it('finds no stage without a view', () => {
    expect(checkStageOf(null, 'draft')).toBeUndefined();
  });
});

describe('pickedStageOf', () => {
  const at = (name: string, index: number, total = 2) => ({
    name,
    index,
    total,
  });

  it('takes the stage in the picked place when the counts match', () => {
    expect(pickedStageOf(view, at('draft', 0))?.agent).toBe('k-developer');
  });

  it('keeps the picked stage while its name is being typed', () => {
    expect(pickedStageOf(view, at('drafting', 0))?.agent).toBe('k-developer');
  });

  it('does not follow a name that now belongs to another stage', () => {
    // The first stage was renamed to the second one's name.
    expect(pickedStageOf(view, at('review', 0))?.agent).toBe('k-developer');
  });

  it('takes no stage when the counts differ, however the names read', () => {
    // A view of another number of stages is of another text.
    expect(pickedStageOf(view, at('review', 0, 3))).toBeUndefined();
    expect(pickedStageOf(view, at('draft', 0, 3))).toBeUndefined();
    expect(pickedStageOf(view, at('wrap-up', 0, 3))).toBeUndefined();
  });

  it('shows no other stage after a stage is added and this one renamed to its name', () => {
    // The person added a third stage and renamed the first to `review`, the
    // name the second already has, before the next check answered. The stale
    // view must not answer with that second stage.
    expect(pickedStageOf(view, at('review', 0, 3))).toBeUndefined();
  });

  it('takes no stage without a view', () => {
    expect(pickedStageOf(null, at('draft', 0))).toBeUndefined();
  });
});

describe('markedStageOf', () => {
  const at = (name: string, index: number, total = 2) => ({
    name,
    index,
    total,
  });

  it('gives the lines of the stage', () => {
    expect(markedStageOf(view, at('draft', 0))).toEqual({
      name: 'draft',
      range: { line: 10, end_line: 12 },
    });
  });

  it('marks the stage in its place while its name is being typed', () => {
    expect(markedStageOf(view, at('drafting', 0))).toEqual({
      name: 'drafting',
      range: { line: 10, end_line: 12 },
    });
  });

  it('marks nothing when the view has another number of stages', () => {
    expect(markedStageOf(view, at('drafting', 0, 3))).toBeUndefined();
  });

  it('marks nothing without a view', () => {
    expect(markedStageOf(undefined, at('draft', 0))).toBeUndefined();
  });

  it.each([
    ['no range', {}],
    ['a range that is not a mapping', { range: 'lines 1 to 2' }],
    ['a line of 0', { range: { line: 0, end_line: 2 } }],
    ['a line that is not whole', { range: { line: 1.5, end_line: 2 } }],
    ['a range that ends before it starts', { range: { line: 9, end_line: 8 } }],
  ])('marks nothing for a stage with %s', (_, over) => {
    const one: CheckView = { ...view, stages: [stageOf(over)] };

    expect(markedStageOf(one, at('draft', 0, 1))).toBeUndefined();
  });
});

describe('fieldValuesOf', () => {
  const draft = { id: 's1', name: 'draft', agent: 'k-developer' };

  it('takes the text keys of the stage in the view', () => {
    expect(fieldValuesOf(checkStageOf(view, 'draft'), draft)).toEqual({
      name: 'draft',
      agent: 'k-developer',
      prompt: 'Write the greeting.',
    });
  });

  it('leaves out the kind and the lines, which are not keys of the file', () => {
    const values = fieldValuesOf(checkStageOf(view, 'draft'), draft);

    expect(values).not.toHaveProperty('kind');
    expect(values).not.toHaveProperty('range');
  });

  it('leaves out a key whose value is not text', () => {
    expect(
      fieldValuesOf(checkStageOf(view, 'review'), {
        id: 's2',
        name: 'review',
        agent: 'k-quality-assurance',
      }),
    ).not.toHaveProperty('outputs');
  });

  it('takes the name and the agent of the draft, which the person is typing', () => {
    expect(
      fieldValuesOf(checkStageOf(view, 'draft'), {
        id: 's1',
        name: 'drafting',
        agent: 'k-architect',
      }),
    ).toMatchObject({ name: 'drafting', agent: 'k-architect' });
  });

  it('gives the name and the agent of a stage the view does not have', () => {
    expect(fieldValuesOf(undefined, draft)).toEqual({
      name: 'draft',
      agent: 'k-developer',
    });
  });
});

describe('droppedKeysOf', () => {
  it('names no key for a stage with a name and an agent only', () => {
    expect(
      droppedKeysOf({ name: 'draft', agent: 'k-developer', kind: 'agent' }),
    ).toEqual([]);
  });

  it('names the keys of the file that a save would lose', () => {
    expect(
      droppedKeysOf({
        name: 'draft',
        kind: 'agent',
        agent: 'k-developer',
        prompt: 'Write it.',
        range: { line: 1, end_line: 2 },
      }),
    ).toEqual(['prompt']);
  });

  it('names a prompt file as well, in one order', () => {
    expect(
      droppedKeysOf({
        name: 'draft',
        prompt_file: 'draft.md',
        done_when: 'x',
      }),
    ).toEqual(['done_when', 'prompt_file']);
  });

  it('names no key for a stage the view does not have', () => {
    expect(droppedKeysOf(undefined)).toEqual([]);
  });

  it('counts the name and the agent as keys a save writes', () => {
    expect(SAVABLE_KEYS).toEqual(['name', 'agent']);
  });
});

describe('sourceStageOf', () => {
  it('takes the stage from the place it was loaded from', () => {
    expect(sourceStageOf(view, { kind: 'loaded', index: 1 })?.agent).toBe(
      'k-quality-assurance',
    );
  });

  it('takes no stage for one that was added since', () => {
    expect(sourceStageOf(view, { kind: 'added' })).toBeUndefined();
  });

  it('takes no stage while the file is not known', () => {
    expect(sourceStageOf(null, { kind: 'loaded', index: 0 })).toBeUndefined();
  });

  it('takes no stage for a place the file does not have', () => {
    expect(sourceStageOf(view, { kind: 'loaded', index: 5 })).toBeUndefined();
  });
});

describe('saveRefusal', () => {
  const draft = (name: string, id = 's1') => ({
    id,
    name,
    agent: 'k-developer',
  });
  const plain = { name: 'draft', agent: 'k-developer' };
  const withPrompt = { ...plain, prompt: 'Write it.' };
  const loaded = (index: number) => ({ kind: 'loaded', index }) as const;
  const added = { kind: 'added' } as const;
  const fileOf = (...stages: CheckViewStage[]): CheckView => ({
    ...view,
    stages,
  });

  it('lets a save of changed stages with no other key go ahead', () => {
    expect(
      saveRefusal(
        [{ draft: draft('drafting'), source: loaded(0), changed: true }],
        fileOf(plain),
      ),
    ).toBeUndefined();
  });

  it('lets a save go ahead when the stage with a prompt is unchanged', () => {
    expect(
      saveRefusal(
        [
          { draft: draft('draft'), source: loaded(0), changed: false },
          {
            draft: draft('reviewing', 's2'),
            source: loaded(1),
            changed: true,
          },
        ],
        fileOf(withPrompt, plain),
      ),
    ).toBeUndefined();
  });

  it('refuses a save that would drop the prompt of a changed stage', () => {
    const refusal = saveRefusal(
      [{ draft: draft('drafting'), source: loaded(0), changed: true }],
      fileOf(withPrompt),
    );

    expect(refusal).toContain('would drop the prompt of drafting');
    expect(refusal).toContain('refused');
  });

  it('names every key the changed stage would lose', () => {
    const refusal = saveRefusal(
      [{ draft: draft('drafting'), source: loaded(0), changed: true }],
      fileOf({ ...plain, prompt_file: 'draft.md', done_when: 'x' }),
    );

    expect(refusal).toContain('done_when and prompt_file');
  });

  it('lets a save of a stage the person added go ahead', () => {
    expect(
      saveRefusal(
        [
          { draft: draft('draft'), source: loaded(0), changed: false },
          { draft: draft('agent-2', 's2'), source: added, changed: true },
        ],
        fileOf(withPrompt),
      ),
    ).toBeUndefined();
  });

  it('refuses a save of a stage changed before the first check settles', () => {
    const refusal = saveRefusal(
      [{ draft: draft('drafting'), source: loaded(0), changed: true }],
      null,
    );

    expect(refusal).toContain('the keys it has in the file are not known');
    expect(refusal).toContain('drafting');
  });

  it('refuses a save of a changed stage when the first check failed', () => {
    expect(
      saveRefusal(
        [{ draft: draft('drafting'), source: loaded(0), changed: true }],
        undefined,
      ),
    ).toContain('not known');
  });

  it('refuses a save of a stage renamed after another was added', () => {
    // The file has two stages; the draft has three, and the loaded first one
    // was renamed, so neither the count nor the name finds it.
    const refusal = saveRefusal(
      [
        { draft: draft('drafting'), source: loaded(0), changed: true },
        { draft: draft('review', 's2'), source: loaded(1), changed: false },
        { draft: draft('agent-3', 's3'), source: added, changed: true },
      ],
      fileOf(withPrompt, plain),
    );

    expect(refusal).toContain('would drop the prompt of drafting');
  });

  it('refuses a save of a stage renamed after another was removed', () => {
    // The file has three stages; the first was deleted and the second, which
    // has the prompt, was renamed.
    const refusal = saveRefusal(
      [{ draft: draft('reviewing', 's2'), source: loaded(1), changed: true }],
      fileOf(plain, withPrompt, plain),
    );

    expect(refusal).toContain('would drop the prompt of reviewing');
  });

  it('refuses a save of a stage renamed after a delete and an add restored the count', () => {
    // The counts match again, so a position would point at the wrong stage:
    // the added stage would answer for the deleted one, which had the prompt.
    const refusal = saveRefusal(
      [
        { draft: draft('reviewing', 's2'), source: loaded(1), changed: true },
        { draft: draft('agent-3', 's3'), source: added, changed: true },
      ],
      fileOf(plain, withPrompt),
    );

    expect(refusal).toContain('would drop the prompt of reviewing');
  });
});
