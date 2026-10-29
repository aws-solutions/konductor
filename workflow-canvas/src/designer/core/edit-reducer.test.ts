// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { DiagnosticView, SaveResult } from '../../api/types';
import { HELLO_DOCUMENT, HELLO_VIEW } from '../../test-support/fixtures';
import { stagesOf } from './draft';
import { reduce } from './edit-reducer';
import { openDocument, type EditEvent, type EditState } from './edit-state';

function opened(): EditState {
  const state = openDocument(HELLO_DOCUMENT);
  if (!state) throw new Error('The sample cannot be edited.');
  return state;
}

function run(state: EditState, ...events: EditEvent[]): EditState {
  return events.reduce((current, event) => {
    const next = reduce(current, event);
    if (!next) throw new Error(`${event.type} left nothing to edit.`);
    return next;
  }, state);
}

function finding(path: string, message = 'Wrong.'): DiagnosticView {
  return { message, path, line: 2, severity: 'error' };
}

const NEW_DOCUMENT = {
  ...HELLO_DOCUMENT,
  hash: 'e'.repeat(64),
  view: { ...HELLO_VIEW, stages: [{ name: 'only', agent: 'k-tpm' }] },
};

const SAVED_HASH = 'b'.repeat(64);

function savedResult(stages = HELLO_VIEW.stages): SaveResult {
  return {
    hash: SAVED_HASH,
    view: { ...HELLO_VIEW, stages },
    diagnostics: [],
  };
}

describe('a read-only workflow', () => {
  const readOnly = (): EditState => {
    const state = openDocument({ ...HELLO_DOCUMENT, readOnly: true });
    if (!state) throw new Error('The sample cannot be edited.');
    return state;
  };

  it.each([
    ['add', { type: 'add' }],
    ['rename', { type: 'rename', id: 's1', name: 'other' }],
    ['set-agent', { type: 'set-agent', id: 's1', agent: 'k-tpm' }],
    ['remove', { type: 'remove', id: 's1' }],
  ] as const)('takes no %s', (_, event) => {
    const state = readOnly();

    expect(run(state, event)).toBe(state);
  });

  it('still lets a stage be selected', () => {
    expect(run(readOnly(), { type: 'select', id: 's2' }).selectedId).toBe('s2');
  });
});

describe('open', () => {
  it('starts a draft of the saved stages with the first one selected', () => {
    const state = opened();

    expect(stagesOf(state.draft)).toEqual(HELLO_VIEW.stages);
    expect(state.selectedId).toBe('s1');
    expect(state.revision).toBe(0);
    expect(state.save).toEqual({ phase: 'idle' });
  });

  it.each([
    ['no file', { text: null, hash: null, view: null }],
    ['a file with errors', { view: null }],
  ])('leaves nothing to edit for %s', (_, change) => {
    expect(openDocument({ ...HELLO_DOCUMENT, ...change })).toBeUndefined();
  });

  it('ignores every other event until a workflow is open', () => {
    expect(reduce(undefined, { type: 'add' })).toBeUndefined();
    expect(
      reduce(undefined, { type: 'open', document: HELLO_DOCUMENT }),
    ).toBeDefined();
  });
});

describe('editing the draft', () => {
  it('adds a stage, selects it and counts a revision', () => {
    const state = run(opened(), { type: 'add' });

    expect(state.draft.stages.at(-1)).toMatchObject({ name: 'agent-1' });
    expect(state.selectedId).toBe(state.draft.stages.at(-1)?.id);
    expect(state.revision).toBe(1);
  });

  it('renames a stage and changes the agent of a stage', () => {
    const state = run(
      opened(),
      { type: 'rename', id: 's1', name: 'write' },
      { type: 'set-agent', id: 's2', agent: 'k-architect' },
    );

    expect(stagesOf(state.draft)).toEqual([
      { name: 'write', agent: 'k-developer' },
      { name: 'review', agent: 'k-architect' },
    ]);
    expect(state.revision).toBe(2);
  });

  it('does not count a revision when a value does not change', () => {
    const start = opened();

    expect(reduce(start, { type: 'rename', id: 's1', name: 'draft' })).toBe(
      start,
    );
    expect(
      reduce(start, { type: 'set-agent', id: 's1', agent: 'k-developer' }),
    ).toBe(start);
    expect(reduce(start, { type: 'rename', id: 'nope', name: 'x' })).toBe(
      start,
    );
  });

  it('deletes the selected stage and selects the one before it', () => {
    const state = run(
      opened(),
      { type: 'select', id: 's2' },
      { type: 'remove', id: 's2' },
    );

    expect(stagesOf(state.draft)).toEqual([HELLO_VIEW.stages[0]]);
    expect(state.selectedId).toBe('s1');
  });

  it('deletes the first stage and selects the next one', () => {
    const state = run(opened(), { type: 'remove', id: 's1' });

    expect(state.selectedId).toBe('s2');
  });

  it('keeps the selection when another stage is deleted', () => {
    const state = run(opened(), { type: 'remove', id: 's2' });

    expect(state.selectedId).toBe('s1');
  });

  it('keeps the last stage', () => {
    const one = run(opened(), { type: 'remove', id: 's2' });

    expect(reduce(one, { type: 'remove', id: 's1' })).toBe(one);
  });

  it('selects only a stage that is in the draft', () => {
    const start = opened();

    expect(run(start, { type: 'select', id: 's2' }).selectedId).toBe('s2');
    expect(reduce(start, { type: 'select', id: 'nope' })).toBe(start);
  });
});

describe('check', () => {
  it('keeps the findings of the check of the current draft', () => {
    const state = run(
      opened(),
      { type: 'add' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [finding('stages[2].name')],
      },
    );

    expect(state.check).toEqual({
      revision: 1,
      diagnostics: [finding('stages[2].name')],
      problems: [
        { message: 'Wrong.', severity: 'error', stageId: 's3', field: 'name' },
      ],
    });
  });

  it('keeps the findings of an older draft on show until the new check answers', () => {
    const state = run(
      opened(),
      { type: 'add' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [finding('stages[2].name')],
      },
      { type: 'rename', id: 's3', name: 'x' },
    );

    expect(state.revision).toBe(2);
    expect(state.check.revision).toBe(1);
    expect(state.check.diagnostics).toEqual([finding('stages[2].name')]);
  });

  it('drops the findings of a draft that has changed since', () => {
    const state = run(
      opened(),
      { type: 'add' },
      { type: 'add' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [finding('stages[2].name')],
      },
    );

    expect(state.check.revision).toBe(0);
  });
});

describe('save', () => {
  const dirty = () =>
    run(opened(), { type: 'set-agent', id: 's1', agent: 'k-tpm' });

  it('starts only when there is something to save', () => {
    expect(run(dirty(), { type: 'save' }).save).toEqual({ phase: 'saving' });
    const clean = opened();
    expect(reduce(clean, { type: 'save' })).toBe(clean);
  });

  it('does not start while the check of the draft has found errors', () => {
    const bad = run(dirty(), {
      type: 'checked',
      revision: 1,
      diagnostics: [finding('stages[0].agent')],
    });

    expect(reduce(bad, { type: 'save' })).toBe(bad);
  });

  it('does not start a second save while one is going', () => {
    const saving = run(dirty(), { type: 'save' });

    expect(reduce(saving, { type: 'save' })).toBe(saving);
  });

  it('makes the sent text the saved one and keeps the draft', () => {
    const saved = run(
      dirty(),
      { type: 'save' },
      {
        type: 'saved',
        text: 'new text',
        result: savedResult([
          { name: 'draft', agent: 'k-tpm' },
          HELLO_VIEW.stages[1]!,
        ]),
      },
    );

    expect(saved.saved).toMatchObject({ text: 'new text', hash: SAVED_HASH });
    expect(saved.saved.view.stages[0]?.agent).toBe('k-tpm');
    expect(saved.save).toEqual({ phase: 'saved' });
    expect(stagesOf(saved.draft)[0]?.agent).toBe('k-tpm');
  });

  it('replaces the findings of an older draft with those of the save', () => {
    const saved = run(
      opened(),
      { type: 'set-agent', id: 's1', agent: 'nope' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [finding('stages[0].agent')],
      },
      { type: 'set-agent', id: 's1', agent: 'k-tpm' },
      { type: 'save' },
      {
        type: 'saved',
        text: 'x',
        result: savedResult([
          { name: 'draft', agent: 'k-tpm' },
          HELLO_VIEW.stages[1]!,
        ]),
      },
    );

    expect(saved.check).toEqual({ revision: 2, diagnostics: [], problems: [] });
  });

  it('leaves the findings alone when the draft changed during the save', () => {
    const saved = run(
      opened(),
      { type: 'set-agent', id: 's1', agent: 'nope' },
      {
        type: 'checked',
        revision: 1,
        diagnostics: [finding('stages[0].agent')],
      },
      { type: 'save' },
      { type: 'rename', id: 's2', name: 'qa' },
      {
        type: 'saved',
        text: 'x',
        result: savedResult([
          { name: 'draft', agent: 'nope' },
          HELLO_VIEW.stages[1]!,
        ]),
      },
    );

    expect(saved.check.revision).toBe(1);
  });

  it('keeps an edit made while the save was going', () => {
    const saved = run(
      dirty(),
      { type: 'save' },
      { type: 'rename', id: 's2', name: 'qa' },
      {
        type: 'saved',
        text: 'sent',
        result: savedResult([
          { name: 'draft', agent: 'k-tpm' },
          HELLO_VIEW.stages[1]!,
        ]),
      },
    );

    expect(saved.draft.stages[1]?.name).toBe('qa');
    expect(saved.saved.view.stages[1]?.name).toBe('review');
  });

  it('forgets that it was saved once the draft changes again', () => {
    const state = run(
      dirty(),
      { type: 'save' },
      { type: 'saved', text: 'x', result: savedResult() },
      { type: 'add' },
    );

    expect(state.save).toEqual({ phase: 'idle' });
  });

  it('waits for a reload after a conflict, and edits do not clear it', () => {
    const state = run(
      dirty(),
      { type: 'save' },
      { type: 'conflict' },
      { type: 'add' },
    );

    expect(state.save).toEqual({ phase: 'conflict' });
    expect(reduce(state, { type: 'save' })).toBe(state);
  });

  it('shows the findings of a refused save for the draft that was sent', () => {
    const state = run(
      dirty(),
      { type: 'save' },
      {
        type: 'refused',
        revision: 1,
        diagnostics: [finding('stages[0].agent')],
      },
    );

    expect(state.save).toEqual({ phase: 'idle' });
    expect(state.check).toEqual({
      revision: 1,
      diagnostics: [finding('stages[0].agent')],
      problems: [
        { message: 'Wrong.', severity: 'error', stageId: 's1', field: 'agent' },
      ],
    });
  });

  it('ignores the findings of a refused save if the draft has changed since', () => {
    const state = run(
      dirty(),
      { type: 'save' },
      { type: 'add' },
      {
        type: 'refused',
        revision: 1,
        diagnostics: [finding('stages[0].agent')],
      },
    );

    expect(state.check.revision).toBe(0);
    expect(state.save).toEqual({ phase: 'idle' });
  });

  it('keeps the sentence of a save that failed, until the draft changes', () => {
    const failed = run(
      dirty(),
      { type: 'save' },
      { type: 'failed', message: 'The server did not answer.' },
    );

    expect(failed.save).toEqual({
      phase: 'failed',
      message: 'The server did not answer.',
    });
    expect(run(failed, { type: 'add' }).save).toEqual({ phase: 'idle' });
  });
});

describe('reload', () => {
  it('starts a new draft from the document and drops the old one', () => {
    const state = run(
      opened(),
      { type: 'add' },
      { type: 'save' },
      { type: 'conflict' },
      { type: 'reload' },
    );
    expect(state.save).toEqual({ phase: 'reloading' });

    const next = run(state, { type: 'reloaded', document: NEW_DOCUMENT });

    expect(stagesOf(next.draft)).toEqual([{ name: 'only', agent: 'k-tpm' }]);
    expect(next.saved.hash).toBe(NEW_DOCUMENT.hash);
    expect(next.revision).toBeGreaterThan(state.revision);
    expect(next.save).toEqual({ phase: 'reloaded' });
  });

  it('stays in the conflict, with a reason, when the file can no longer be edited', () => {
    const state = run(
      opened(),
      { type: 'conflict' },
      { type: 'reload' },
      { type: 'reloaded', document: { ...HELLO_DOCUMENT, view: null } },
    );

    expect(state.save).toMatchObject({ phase: 'conflict' });
    expect(state.save).toHaveProperty('problem');
  });

  it('stays in the conflict, with the sentence, when the load failed', () => {
    const state = run(
      opened(),
      { type: 'conflict' },
      { type: 'reload' },
      { type: 'reload-failed', message: 'The server did not answer.' },
    );

    expect(state.save).toEqual({
      phase: 'conflict',
      problem: 'The server did not answer.',
    });
  });
});

describe('an answer that is meant for an earlier document or an earlier save', () => {
  const OLD_ERROR = finding('stages[0].name');

  function reloadedAfterEdits(): { before: EditState; after: EditState } {
    const before = run(
      opened(),
      { type: 'rename', id: 's1', name: 'a' },
      { type: 'rename', id: 's1', name: 'b' },
      { type: 'save' },
      { type: 'conflict' },
      { type: 'reload' },
    );
    const after = run(
      before,
      { type: 'reloaded', document: NEW_DOCUMENT },
      { type: 'rename', id: 's1', name: 'c' },
      { type: 'rename', id: 's1', name: 'd' },
    );
    return { before, after };
  }

  it('does not count a revision twice, also across a reload', () => {
    const { before, after } = reloadedAfterEdits();

    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it('ignores the check of a draft from before a reload', () => {
    const { before, after } = reloadedAfterEdits();

    const next = run(after, {
      type: 'checked',
      revision: before.revision,
      diagnostics: [OLD_ERROR],
    });

    expect(next.check).toBe(after.check);
  });

  it('ignores the check of a draft from before a new document was opened', () => {
    const before = run(opened(), { type: 'rename', id: 's1', name: 'a' });
    const after = reduce(before, { type: 'open', document: NEW_DOCUMENT })!;

    expect(after.revision).toBeGreaterThan(before.revision);
    expect(
      run(after, {
        type: 'checked',
        revision: before.revision,
        diagnostics: [OLD_ERROR],
      }).check,
    ).toBe(after.check);
  });

  it.each([
    ['saved', { type: 'saved', text: 'x', result: savedResult() }],
    ['conflict', { type: 'conflict' }],
    ['refused', { type: 'refused', revision: 0, diagnostics: [] }],
    ['failed', { type: 'failed', message: 'Late.' }],
  ] as const)('ignores a late %s when no save is going on', (_, event) => {
    const state = run(opened(), { type: 'rename', id: 's1', name: 'a' });

    expect(reduce(state, event)).toBe(state);
  });

  it.each([
    ['reloaded', { type: 'reloaded', document: NEW_DOCUMENT }],
    ['reload-failed', { type: 'reload-failed', message: 'Late.' }],
  ] as const)('ignores a late %s when no reload is going on', (_, event) => {
    const state = run(opened(), { type: 'rename', id: 's1', name: 'a' });

    expect(reduce(state, event)).toBe(state);
  });

  it('does not let a late save answer replace the file of a reload', () => {
    const { after } = reloadedAfterEdits();

    const next = reduce(after, {
      type: 'saved',
      text: 'old',
      result: savedResult(),
    });

    expect(next?.saved.hash).toBe(NEW_DOCUMENT.hash);
  });

  it('keeps that a failed save may have been written', () => {
    const state = run(
      opened(),
      { type: 'rename', id: 's1', name: 'a' },
      { type: 'save' },
      { type: 'failed', message: 'No answer.', uncertain: true },
    );

    expect(state.save).toEqual({
      phase: 'failed',
      message: 'No answer.',
      uncertain: true,
    });
  });
});

describe('removing a stage that is not in the draft', () => {
  it('is not a change', () => {
    const state = opened();

    expect(reduce(state, { type: 'remove', id: 'nope' })).toBe(state);
  });
});
