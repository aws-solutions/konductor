// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  addParam,
  addStage,
  canAddStage,
  canRemoveStage,
  DEFAULT_AGENT,
  draftOf,
  insertStage,
  MAX_STAGES,
  neighbourOf,
  removeParam,
  removeStage,
  renameStage,
  sameStages,
  setAgent,
  setParam,
  setPrompt,
  stagesOf,
} from './draft';

const TWO = [
  { name: 'draft', agent: 'k-developer' },
  { name: 'review', agent: 'k-quality-assurance' },
];

describe('draftOf and stagesOf', () => {
  it('gives each stage an id of its own and gives the stages back in order', () => {
    const draft = draftOf(TWO);

    expect(draft.stages.map((stage) => stage.id)).toEqual(['s1', 's2']);
    expect(stagesOf(draft)).toEqual(TWO);
  });
});

describe('parameter rows', () => {
  it('synthesizes one protected goal row when the view omits params', () => {
    const [goal] = draftOf(TWO).params;

    expect(goal).toMatchObject({
      id: 'p-goal',
      isGoal: true,
      name: 'goal',
    });
  });

  it('protects only the stable goal row, not another row typed as goal', () => {
    let draft = addParam(draftOf(TWO));
    const added = draft.params.at(-1)!;
    draft = setParam(draft, added.id, { name: 'goal' });

    expect(draft.params.at(-1)?.name).toBe('goal');
    expect(removeParam(draft, added.id).params).toHaveLength(1);
    expect(setParam(draft, 'p-goal', { name: 'other' }).params[0]?.name).toBe(
      'goal',
    );
    expect(removeParam(draft, 'p-goal')).toBe(draft);
  });

  it('adds the first free contract-valid param_N name', () => {
    let draft = draftOf(TWO, [], { param_1: {}, param_3: {} });
    draft = addParam(draft);

    expect(draft.params.at(-1)?.name).toBe('param_2');
  });
});

describe('addStage', () => {
  it('adds a stage at the end with the first free name and the default agent', () => {
    const draft = addStage(draftOf(TWO));

    expect(stagesOf(draft).at(-1)).toEqual({
      name: 'agent-1',
      agent: DEFAULT_AGENT,
    });
    expect(draft.stages).toHaveLength(3);
  });

  it('skips a name that a stage already has', () => {
    const taken = draftOf([
      { name: 'agent-1', agent: 'k-developer' },
      { name: 'agent-3', agent: 'k-developer' },
    ]);

    expect(stagesOf(addStage(taken)).at(-1)?.name).toBe('agent-2');
  });

  it('gives a new stage an id that no earlier stage had, even after a delete', () => {
    let draft = draftOf(TWO);
    draft = removeStage(draft, 's2');
    draft = addStage(draft);

    expect(draft.stages.map((stage) => stage.id)).toEqual(['s1', 's3']);
  });

  it('adds nothing past the most stages the API allows', () => {
    const full = draftOf(
      Array.from({ length: MAX_STAGES }, (_, index) => ({
        name: `stage-${index}`,
        agent: 'k-developer',
      })),
    );

    expect(canAddStage(full)).toBe(false);
    expect(addStage(full)).toBe(full);
    expect(canAddStage(draftOf(TWO))).toBe(true);
  });
});

describe('insertStage', () => {
  it('inserts the chosen agent at a bounded index with the next free name', () => {
    const inserted = insertStage(draftOf(TWO), 1, 'k-architect');

    expect(stagesOf(inserted)).toEqual([
      TWO[0],
      { name: 'agent-1', agent: 'k-architect' },
      TWO[1],
    ]);
    expect(inserted.stages[1]?.id).toBe('s3');
    expect(stagesOf(insertStage(draftOf(TWO), 99, 'k-tpm')).at(-1)).toEqual({
      name: 'agent-1',
      agent: 'k-tpm',
    });
  });
});

describe('renameStage and setAgent', () => {
  it('change only the stage with the id', () => {
    const draft = draftOf(TWO);

    expect(stagesOf(renameStage(draft, 's2', 'qa'))).toEqual([
      TWO[0],
      { name: 'qa', agent: 'k-quality-assurance' },
    ]);
    expect(stagesOf(setAgent(draft, 's1', 'k-architect'))).toEqual([
      { name: 'draft', agent: 'k-architect' },
      TWO[1],
    ]);
  });

  it('keep the id of a stage that was renamed', () => {
    const draft = renameStage(draftOf(TWO), 's1', 'first');

    expect(draft.stages[0]?.id).toBe('s1');
  });

  it('take the name as typed, even one the API would refuse', () => {
    const draft = renameStage(draftOf(TWO), 's1', 'Not A Name');

    expect(draft.stages[0]?.name).toBe('Not A Name');
  });
});

describe('removeStage', () => {
  it('removes the stage with the id', () => {
    expect(stagesOf(removeStage(draftOf(TWO), 's1'))).toEqual([TWO[1]]);
  });

  it('keeps the last stage', () => {
    const one = draftOf([TWO[0]!]);

    expect(canRemoveStage(one)).toBe(false);
    expect(removeStage(one, 's1')).toBe(one);
    expect(canRemoveStage(draftOf(TWO))).toBe(true);
  });
});

describe('neighbourOf', () => {
  const three = draftOf([...TWO, { name: 'ship', agent: 'k-developer' }]);

  it('is the stage before, or the next one for the first stage', () => {
    expect(neighbourOf(three, 's3')).toBe('s2');
    expect(neighbourOf(three, 's2')).toBe('s1');
    expect(neighbourOf(three, 's1')).toBe('s2');
  });

  it('is nothing for an id the draft does not have', () => {
    expect(neighbourOf(three, 'nope')).toBeUndefined();
  });
});

describe('sameStages', () => {
  it('compares names and agents in order', () => {
    expect(sameStages(TWO, [...TWO])).toBe(true);
    expect(sameStages(TWO, [...TWO].reverse())).toBe(false);
    expect(sameStages(TWO, TWO.slice(0, 1))).toBe(false);
    expect(
      sameStages(TWO, [TWO[0]!, { ...TWO[1]!, agent: 'k-architect' }]),
    ).toBe(false);
  });
});

describe('the prompt of a stage', () => {
  it('starts as the prompts of the saved stages, with none for a stage that has no text', () => {
    const draft = draftOf(TWO, ['Write it.']);

    expect(draft.stages.map((stage) => stage.prompt)).toEqual([
      'Write it.',
      '',
    ]);
  });

  it('is empty for a stage that is added', () => {
    expect(addStage(draftOf(TWO)).stages.at(-1)?.prompt).toBe('');
  });

  it('is set as typed on one stage and leaves the rest of the draft alone', () => {
    const draft = draftOf(TWO, ['a', 'b']);

    const next = setPrompt(draft, 's2', ' c\nd ');

    expect(next.stages.map((stage) => stage.prompt)).toEqual(['a', ' c\nd ']);
    expect(stagesOf(next)).toEqual(TWO);
    expect(next.nextId).toBe(draft.nextId);
  });

  it('is not part of what makes two lists of stages the same', () => {
    expect(sameStages(stagesOf(draftOf(TWO, ['a'])), TWO)).toBe(true);
  });
});
