// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { DiagnosticView } from '../../api/types';
import {
  HELLO_DOCUMENT,
  HELLO_TEXT,
  HELLO_VIEW,
  stageViewOf,
} from '../../test-support/fixtures';
import { reduce } from './edit-reducer';
import { openDocument, type EditEvent, type EditState } from './edit-state';
import { listedOf, problemsFor } from './problems';
import {
  canSave,
  isDirty,
  problemsOfDraft,
  promptFieldOf,
  saveBlocker,
  saveStatus,
  textOf,
  writtenOf,
} from './edit-view';

function run(...events: EditEvent[]): EditState {
  let state = openDocument(HELLO_DOCUMENT);
  for (const event of events) state = reduce(state, event);
  if (!state) throw new Error('Nothing to edit.');
  return state;
}

const AGENT_CHANGE: EditEvent = { type: 'set-agent', id: 's1', agent: 'k-tpm' };

function error(path: string): DiagnosticView {
  return { message: 'Wrong.', path, line: 1, severity: 'error' };
}

describe('isDirty', () => {
  it('is true while the draft differs from the saved stages', () => {
    expect(isDirty(run())).toBe(false);
    expect(isDirty(run(AGENT_CHANGE))).toBe(true);
  });

  it('is false again when the change is undone', () => {
    const undone = run(AGENT_CHANGE, {
      type: 'set-agent',
      id: 's1',
      agent: 'k-developer',
    });

    expect(isDirty(undone)).toBe(false);
  });
});

describe('textOf', () => {
  it('is the saved text when nothing changed', () => {
    expect(textOf(run())).toBe(HELLO_TEXT);
  });

  it('is the saved text with the stages of the draft', () => {
    expect(textOf(run(AGENT_CHANGE))).toBe(
      HELLO_TEXT.replace('k-developer', 'k-tpm'),
    );
  });
});

describe('writtenOf', () => {
  it('gives the same result again for the same draft, document and bases', () => {
    const state = run(AGENT_CHANGE);

    expect(writtenOf({ ...state })).toBe(writtenOf(state));
  });

  it('writes again when the draft, the document or the bases change', () => {
    const state = run(AGENT_CHANGE);
    const first = writtenOf(state);
    const other = { ...state.draft.stages[0]!, id: 's9' };

    const moved = writtenOf({
      ...state,
      bases: ['s9', ...state.bases.slice(1)],
    });
    const draft = writtenOf({
      ...state,
      draft: {
        ...state.draft,
        stages: [other, ...state.draft.stages.slice(1)],
      },
    });
    const saved = writtenOf({
      ...state,
      saved: { ...state.saved },
    });

    expect(moved).not.toBe(first);
    expect(draft).not.toBe(first);
    expect(saved).not.toBe(first);
    expect(saved).toEqual(first);
  });
});

describe('textOf, across saves', () => {
  // A file whose stages carry the keys the Designer does not edit.
  const PROMPTED = {
    ...HELLO_DOCUMENT,
    text: 'format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Add a greeting to the README\nstages:\n  - name: draft\n    agent: k-developer\n    prompt: Write the greeting.\n  - name: review\n    agent: k-quality-assurance\n    prompt_file: review.md\n',
  };

  function runOn(state: EditState | undefined, ...events: EditEvent[]) {
    for (const event of events) state = reduce(state, event);
    if (!state) throw new Error('Nothing to edit.');
    return state;
  }

  // The answer to a save of the text that was sent, with the stages it holds.
  function savedOf(
    state: EditState,
    stages: EditState['saved']['view']['stages'],
  ): EditEvent {
    return {
      type: 'saved',
      text: textOf(state)!,
      result: {
        hash: 'b'.repeat(64),
        view: { ...state.saved.view, stages },
        diagnostics: [],
      },
    };
  }

  it('keeps the prompt of a stage whose agent changes', () => {
    const state = runOn(openDocument(PROMPTED), AGENT_CHANGE);

    expect(textOf(state)).toBe(PROMPTED.text.replace('k-developer', 'k-tpm'));
  });

  it('keeps the prompt of a renamed stage in the text a save writes', () => {
    const PLAN = {
      ...HELLO_DOCUMENT,
      text: [
        'format: konductor/1',
        'name: hello',
        'version: 0.1.0',
        'intent:',
        '  outcome: Add a greeting to the README',
        'stages:',
        '  - name: plan',
        '    agent: k-architect',
        '    prompt: >-',
        '      Write a short plan for the goal to PLAN.md.',
        '      Do not change any other file.',
        '  - name: implement',
        '    agent: k-developer',
        '    prompt: Read PLAN.md and do its first step only.',
        '',
      ].join('\n'),
      view: {
        ...HELLO_VIEW,
        stages: [
          stageViewOf('plan', 'k-architect'),
          stageViewOf('implement', 'k-developer'),
        ],
      },
    };

    const renamed = runOn(openDocument(PLAN), {
      type: 'rename',
      id: 's1',
      name: 'planning',
    });

    expect(textOf(renamed)).toBe(
      PLAN.text.replace('- name: plan\n', '- name: planning\n'),
    );

    // The same holds for the next rename, after the first one was saved.
    const sending = runOn(renamed, { type: 'save' });
    const sent = textOf(renamed)!;
    const saved = runOn(sending, {
      type: 'saved',
      text: sent,
      result: {
        hash: 'b'.repeat(64),
        view: {
          ...PLAN.view,
          stages: [
            stageViewOf('planning', 'k-architect'),
            stageViewOf('implement', 'k-developer'),
          ],
        },
        diagnostics: [],
      },
    });
    const again = runOn(saved, { type: 'rename', id: 's1', name: 'draft' });

    expect(textOf(again)).toBe(
      sent.replace('- name: planning\n', '- name: draft\n'),
    );
  });

  it('edits a stage in place after a save that deleted the one before it', () => {
    const deleted = runOn(
      openDocument(PROMPTED),
      { type: 'remove', id: 's1' },
      {
        type: 'save',
      },
    );
    const saved = runOn(
      deleted,
      savedOf(deleted, [stageViewOf('review', 'k-quality-assurance')]),
    );

    const next = runOn(saved, { type: 'set-agent', id: 's2', agent: 'k-tpm' });

    expect(textOf(next)).toBe(
      textOf(deleted)!.replace('k-quality-assurance', 'k-tpm'),
    );
    expect(textOf(next)).toContain('prompt_file: review.md');
  });

  it('knows the stages that were sent when an editable field changed during the save', () => {
    const saving = runOn(
      openDocument(PROMPTED),
      { type: 'rename', id: 's1', name: 'write' },
      { type: 'save' },
    );
    const sent = textOf(saving)!;
    const saved = runOn(
      saving,
      { type: 'rename', id: 's2', name: 'qa' },
      savedOf(saving, [
        stageViewOf('write', 'k-developer'),
        stageViewOf('review', 'k-quality-assurance'),
      ]),
    );

    const next = runOn(saved, { type: 'set-agent', id: 's1', agent: 'k-tpm' });

    expect(isDirty(next)).toBe(true);
    expect(textOf(next)).toBe(
      sent
        .replace('agent: k-developer', 'agent: k-tpm')
        .replace('name: review', 'name: qa'),
    );
  });
});

describe('saveBlocker', () => {
  it('says there is nothing to save when nothing changed', () => {
    expect(saveBlocker(run())).toBe('There are no changes to save.');
  });

  it('is nothing for a change that was not found wrong', () => {
    expect(saveBlocker(run(AGENT_CHANGE))).toBeUndefined();
    expect(canSave(run(AGENT_CHANGE))).toBe(true);
  });

  it('says to fix the problems when the check of the draft found errors', () => {
    const state = run(AGENT_CHANGE, {
      type: 'checked',
      revision: 1,
      diagnostics: [error('stages[0].agent')],
    });

    expect(saveBlocker(state)).toBe('Fix the problems in the workflow first.');
  });

  it('does not count a finding of the draft before the change', () => {
    const state = run(
      { type: 'checked', revision: 0, diagnostics: [error('stages[0].agent')] },
      AGENT_CHANGE,
    );

    expect(canSave(state)).toBe(true);
  });

  it('does not count a warning or a note as a reason to stop', () => {
    const state = run(AGENT_CHANGE, {
      type: 'checked',
      revision: 1,
      diagnostics: [
        { ...error('stages[0].agent'), severity: 'warning' },
        { ...error('stages[0].name'), severity: 'info' },
      ],
    });

    expect(saveBlocker(state)).toBeUndefined();
  });

  it('says the workflow is read-only when the server says so', () => {
    const open = openDocument({ ...HELLO_DOCUMENT, readOnly: true });
    const state = reduce(open, AGENT_CHANGE);

    expect(state && saveBlocker(state)).toBe('The workflow is read-only.');
  });

  it.each([
    ['saving', [{ type: 'save' }], 'The workflow is being saved.'],
    [
      'a conflict',
      [{ type: 'save' }, { type: 'conflict' }],
      'The file changed on disk. Reload it first.',
    ],
    ['reloading', [{ type: 'reload' }], 'The workflow is being loaded again.'],
  ] as const)('says why not during %s', (_, events, reason) => {
    expect(saveBlocker(run(AGENT_CHANGE, ...events))).toBe(reason);
  });
});

describe('problemsOfDraft', () => {
  it('lists the findings of the check of the draft as it is now', () => {
    const state = run(AGENT_CHANGE, {
      type: 'checked',
      revision: 1,
      diagnostics: [error('stages[0].agent')],
    });

    expect(problemsOfDraft(state)).toEqual([
      { message: 'Wrong.', severity: 'error', stageId: 's1', field: 'agent' },
    ]);
  });

  it('keeps the last problems on show while the check of the draft is still to come', () => {
    const state = run(
      { type: 'checked', revision: 0, diagnostics: [error('stages[0].agent')] },
      AGENT_CHANGE,
    );

    expect(problemsOfDraft(state)).toEqual([
      { message: 'Wrong.', severity: 'error', stageId: 's1', field: 'agent' },
    ]);
  });

  it('keeps a problem on its stage when the stages move', () => {
    const state = run(
      { type: 'checked', revision: 0, diagnostics: [error('stages[1].name')] },
      { type: 'remove', id: 's1' },
    );

    expect(problemsOfDraft(state)).toEqual([
      { message: 'Wrong.', severity: 'error', stageId: 's2', field: 'name' },
    ]);
  });

  it('marks the field of the earlier stage when a name is repeated, as the server names the later one', () => {
    const state = run(
      { type: 'rename', id: 's1', name: 'review' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [error('stages[1].name')],
      },
    );

    const problems = problemsOfDraft(state);

    expect(problemsFor(problems, 's1', 'name')).toHaveLength(1);
    expect(problemsFor(problems, 's2', 'name')).toHaveLength(1);
    expect(listedOf(problems)).toHaveLength(1);
  });

  it('stops marking the earlier stage as soon as its name is changed again', () => {
    const state = run(
      { type: 'rename', id: 's1', name: 'review' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [error('stages[1].name')],
      },
      { type: 'rename', id: 's1', name: 'draft' },
    );

    expect(problemsFor(problemsOfDraft(state), 's1', 'name')).toEqual([]);
  });

  it('drops a problem of a stage that was deleted, and keeps one of the whole text', () => {
    const state = run(
      {
        type: 'checked',
        revision: 0,
        diagnostics: [error('stages[1].name'), error('intent')],
      },
      { type: 'remove', id: 's2' },
    );

    expect(problemsOfDraft(state)).toEqual([
      { message: 'Wrong.', severity: 'error' },
    ]);
  });
});

describe('saveStatus', () => {
  it.each([
    ['nothing changed', [], 'pending', 'No changes'],
    ['a change', [AGENT_CHANGE], 'warning', 'Unsaved changes'],
    [
      'a save under way',
      [AGENT_CHANGE, { type: 'save' }],
      'in-progress',
      'Saving',
    ],
    ['a reload under way', [{ type: 'reload' }], 'in-progress', 'Loading'],
    [
      'a reload that ended',
      [{ type: 'reload' }, { type: 'reloaded', document: HELLO_DOCUMENT }],
      'success',
      'Loaded again from the server',
    ],
  ] as const)('says it for %s', (_, events, kind, text) => {
    expect(saveStatus(run(...events))).toEqual({ kind, text });
  });

  it('says Saved after a save, until the draft changes', () => {
    const saved = run(
      AGENT_CHANGE,
      { type: 'save' },
      {
        type: 'saved',
        text: 'x',
        result: {
          hash: 'b'.repeat(64),
          view: {
            ...HELLO_DOCUMENT.view!,
            stages: [
              stageViewOf('draft', 'k-tpm'),
              HELLO_DOCUMENT.view!.stages[1]!,
            ],
          },
          diagnostics: [],
        },
      },
    );

    expect(saveStatus(saved)).toEqual({ kind: 'success', text: 'Saved' });
    expect(saveStatus(reduce(saved, { type: 'add' })!).text).toBe(
      'Unsaved changes',
    );
  });
});

describe('the prompt of a stage', () => {
  const PROMPT = 'Write the greeting to README.md.';
  const type = (prompt: string, id = 's1'): EditEvent => ({
    type: 'set-prompt',
    id,
    prompt,
  });

  it('is dirty once typed over, and clean again when typed back', () => {
    expect(isDirty(run(type('Hi.')))).toBe(true);
    expect(isDirty(run(type('Hi.'), type(PROMPT)))).toBe(false);
  });

  it('is written into the text a save sends, and nothing else changes', () => {
    expect(textOf(run(type('Hi.')))).toBe(HELLO_TEXT.replace(PROMPT, 'Hi.'));
  });

  it('writes the text of the saved file for a draft with no change', () => {
    expect(textOf(run())).toBe(HELLO_TEXT);
    expect(textOf(run(type('Hi.'), type(PROMPT)))).toBe(HELLO_TEXT);
  });

  it('turns Save off, with the reason, for a prompt that cannot be written in place', () => {
    const flow = {
      ...HELLO_DOCUMENT,
      text: HELLO_TEXT.replace(
        `  - name: draft\n    agent: k-developer\n    prompt: ${PROMPT}\n`,
        '  - {name: draft, agent: k-developer, prompt: Hi}\n',
      ),
    };
    let state = openDocument(flow);
    state = reduce(state, type(''));

    expect(canSave(state!)).toBe(false);
    expect(saveBlocker(state!)).toContain('flow form');
  });

  it.each([
    ['a prompt', 's1', { kind: 'text' }],
    [
      'a stage with no prompt of its own, such as a new one',
      's9',
      { kind: 'text' },
    ],
    ['a prompt_file', 's2', { kind: 'file', path: 'review.md' }],
  ] as const)('is offered as text or a file for %s', (_, id, field) => {
    const state = run();
    const stage = { id, name: 'x', agent: 'y', prompt: '' };

    expect(promptFieldOf(state, stage)).toEqual(field);
  });

  it('is blocked, with the reason, when the file cannot be read', () => {
    const state = openDocument({
      ...HELLO_DOCUMENT,
      text: HELLO_TEXT.replace('format: konductor/1', 'format: [konductor/1'),
    })!;

    expect(promptFieldOf(state, state.draft.stages[0]!)).toMatchObject({
      kind: 'blocked',
    });
  });

  it('tells a stage with both keys from one with a file', () => {
    const both = openDocument({
      ...HELLO_DOCUMENT,
      text: HELLO_TEXT.replace(
        '    prompt_file: review.md',
        '    prompt: x\n    prompt_file: review.md',
      ),
    })!;

    expect(promptFieldOf(both, both.draft.stages[1]!)).toEqual({
      kind: 'both',
      path: 'review.md',
    });
    expect(both.draft.stages[1]?.prompt).toBe('x');
  });
});
