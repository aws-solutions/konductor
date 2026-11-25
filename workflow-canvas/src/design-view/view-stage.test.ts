// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { CheckView } from '../designer-view/yaml-draft';
import {
  SAVABLE_KEYS,
  checkStageOf,
  fieldValuesOf,
  markedStageOf,
  pickedStageOf,
  sourceStageOf,
  type StageSource,
  type ViewStanding,
} from './view-stage';

/** A stage the person added since the file was loaded. */
const ADDED: StageSource = { kind: 'added' };

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

// The stages of the draft as they were loaded, each in its own place.
const asLoaded = (count: number): StageSource[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: 'loaded' as const,
    index,
  }));

/** A view of the text as it is now, which the draft's places name. */
const ofNow = (count = 2): ViewStanding => ({
  stale: false,
  sources: asLoaded(count),
});

/** A view of an earlier text, with the draft unchanged since the load. */
const earlier = (count = 2): ViewStanding => ({
  stale: true,
  sources: asLoaded(count),
});

describe('pickedStageOf', () => {
  const at = (name: string, index: number, total = 2) => ({
    name,
    index,
    total,
  });

  it('takes the stage in the picked place when the counts match', () => {
    expect(pickedStageOf(view, at('draft', 0), ofNow())?.agent).toBe(
      'k-developer',
    );
  });

  it('keeps the picked stage while its name is being typed', () => {
    expect(pickedStageOf(view, at('drafting', 0), ofNow())?.agent).toBe(
      'k-developer',
    );
  });

  it('does not follow a name that now belongs to another stage', () => {
    // The first stage was renamed to the second one's name.
    expect(pickedStageOf(view, at('review', 0), ofNow())?.agent).toBe(
      'k-developer',
    );
  });

  it('takes no stage when the counts differ, however the names read', () => {
    // A view of another number of stages is of another text.
    expect(pickedStageOf(view, at('review', 0, 3), ofNow(3))).toBeUndefined();
    expect(pickedStageOf(view, at('draft', 0, 3), ofNow(3))).toBeUndefined();
    expect(pickedStageOf(view, at('wrap-up', 0, 3), ofNow(3))).toBeUndefined();
  });

  it('shows no other stage after a stage is added and this one renamed to its name', () => {
    // The person added a third stage and renamed the first to `review`, the
    // name the second already has, before the next check answered. The stale
    // view must not answer with that second stage.
    expect(pickedStageOf(view, at('review', 0, 3), earlier(3))).toBeUndefined();
  });

  it('reads an earlier view while the draft still holds the stages of the file', () => {
    expect(pickedStageOf(view, at('drafting', 0), earlier())?.agent).toBe(
      'k-developer',
    );
  });

  it('takes no stage from an earlier view once a stage was added', () => {
    const sources: StageSource[] = [{ kind: 'loaded', index: 0 }, ADDED];

    expect(
      pickedStageOf(view, at('agent-2', 1, 2), { stale: true, sources }),
    ).toBeUndefined();
  });

  it('takes no stage from an earlier view after a delete and an add keep the count', () => {
    // `draft` was deleted and a stage added, so the draft is [review, agent-3]
    // and the earlier view is [draft, review]: both hold two stages, and every
    // place of the view names another stage.
    const sources: StageSource[] = [{ kind: 'loaded', index: 1 }, ADDED];
    const standing = { stale: true, sources };

    expect(pickedStageOf(view, at('review', 0, 2), standing)).toBeUndefined();
    expect(pickedStageOf(view, at('agent-3', 1, 2), standing)).toBeUndefined();
  });

  it('reads the view of the text as it is now after such an edit', () => {
    // Its stages are the stages of this draft, so the place names them.
    const sources: StageSource[] = [{ kind: 'loaded', index: 1 }, ADDED];

    expect(
      pickedStageOf(view, at('review', 0, 2), { stale: false, sources })?.name,
    ).toBe('draft');
  });

  it('takes no stage without a view', () => {
    expect(pickedStageOf(null, at('draft', 0), ofNow())).toBeUndefined();
  });
});

describe('markedStageOf', () => {
  const at = (name: string, index: number, total = 2) => ({
    name,
    index,
    total,
  });

  it('gives the lines of the stage', () => {
    expect(markedStageOf(view, at('draft', 0), ofNow())).toEqual({
      name: 'draft',
      range: { line: 10, end_line: 12 },
    });
  });

  it('marks the stage in its place while its name is being typed', () => {
    expect(markedStageOf(view, at('drafting', 0), ofNow())).toEqual({
      name: 'drafting',
      range: { line: 10, end_line: 12 },
    });
  });

  it('marks nothing when the view has another number of stages', () => {
    expect(markedStageOf(view, at('drafting', 0, 3), ofNow(3))).toBeUndefined();
  });

  it('marks nothing from an earlier view after a delete and an add', () => {
    const sources: StageSource[] = [{ kind: 'loaded', index: 1 }, ADDED];

    expect(
      markedStageOf(view, at('review', 0, 2), { stale: true, sources }),
    ).toBeUndefined();
  });

  it('marks nothing without a view', () => {
    expect(markedStageOf(undefined, at('draft', 0), ofNow())).toBeUndefined();
  });

  it.each([
    ['no range', {}],
    ['a range that is not a mapping', { range: 'lines 1 to 2' }],
    ['a line of 0', { range: { line: 0, end_line: 2 } }],
    ['a line that is not whole', { range: { line: 1.5, end_line: 2 } }],
    ['a range that ends before it starts', { range: { line: 9, end_line: 8 } }],
  ])('marks nothing for a stage with %s', (_, over) => {
    const one: CheckView = { ...view, stages: [stageOf(over)] };

    expect(markedStageOf(one, at('draft', 0, 1), ofNow(1))).toBeUndefined();
  });
});

describe('fieldValuesOf', () => {
  const draft = {
    id: 's1',
    name: 'draft',
    agent: 'k-developer',
    prompt: 'Write the greeting.',
  };

  it('takes the text keys of the stage in the view', () => {
    expect(fieldValuesOf(checkStageOf(view, 'draft'), draft)).toEqual({
      name: 'draft',
      agent: 'k-developer',
      prompt: 'Write the greeting.',
    });
  });

  it('shows the prompt of the draft, which is the one being typed', () => {
    const typed = { ...draft, prompt: 'Write it twice.' };

    expect(fieldValuesOf(checkStageOf(view, 'draft'), typed)).toMatchObject({
      prompt: 'Write it twice.',
    });
  });

  it('keeps the prompt of the file when the editor cannot read it', () => {
    const unread = { ...draft, prompt: '' };

    expect(
      fieldValuesOf(checkStageOf(view, 'draft'), unread, {
        promptRead: false,
      }),
    ).toMatchObject({ prompt: 'Write the greeting.' });
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
        prompt: '',
      }),
    ).not.toHaveProperty('outputs');
  });

  it('takes the name and the agent of the draft, which the person is typing', () => {
    expect(
      fieldValuesOf(checkStageOf(view, 'draft'), {
        id: 's1',
        name: 'drafting',
        agent: 'k-architect',
        prompt: '',
      }),
    ).toMatchObject({ name: 'drafting', agent: 'k-architect' });
  });

  it('gives the name, the agent and the prompt of a stage the view lacks', () => {
    expect(fieldValuesOf(undefined, draft)).toEqual({
      name: 'draft',
      agent: 'k-developer',
      prompt: 'Write the greeting.',
    });
  });
});

describe('SAVABLE_KEYS', () => {
  it('names the keys the form lets a person type in', () => {
    expect(SAVABLE_KEYS).toEqual(['name', 'agent', 'prompt']);
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
