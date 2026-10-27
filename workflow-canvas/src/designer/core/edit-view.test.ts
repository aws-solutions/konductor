// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { DiagnosticView } from '../../api/types';
import { HELLO_DOCUMENT, HELLO_TEXT } from '../../test-support/fixtures';
import { reduce } from './edit-reducer';
import { openDocument, type EditEvent, type EditState } from './edit-state';
import { listedOf, problemsFor } from './problems';
import {
  canSave,
  isDirty,
  problemsOfDraft,
  saveBlocker,
  textOf,
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
      [{ type: 'conflict' }],
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
