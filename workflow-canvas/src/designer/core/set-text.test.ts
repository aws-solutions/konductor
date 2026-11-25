// SPDX-License-Identifier: Apache-2.0
/** Checks the raw edit: the whole text typed over, and what a save makes of it. */
import { describe, expect, it } from 'vitest';
import { HELLO_DOCUMENT, HELLO_TEXT } from '../../test-support/fixtures';
import { viewOfText } from '../../test-support/fake-edits';
import { reduce } from './edit-reducer';
import { openDocument, type EditEvent, type EditState } from './edit-state';
import {
  canSave,
  changeBlocker,
  isDirty,
  RAW_EDIT_REASON,
  rawTextOf,
  textOf,
  writeBlocker,
} from './edit-view';

const TYPED = `${HELLO_TEXT}# typed over\n`;

const opened = (): EditState => {
  const state = openDocument(HELLO_DOCUMENT);
  if (!state) throw new Error('The sample document must be editable.');
  return state;
};

function after(
  state: EditState | undefined,
  ...events: readonly EditEvent[]
): EditState {
  const next = events.reduce<EditState | undefined>(
    (current, event) => reduce(current, event),
    state,
  );
  if (!next) throw new Error('The editor lost its state.');
  return next;
}

const savedOf = (text: string) => ({
  type: 'saved' as const,
  text,
  result: { hash: 'c'.repeat(64), view: viewOfText(text), diagnostics: [] },
});

describe('a raw edit', () => {
  it('keeps the text, bumps the revision and leaves the draft alone', () => {
    const start = opened();
    const state = after(start, { type: 'set-text', text: TYPED });

    expect(rawTextOf(state)).toBe(TYPED);
    expect(state.revision).toBe(start.revision + 1);
    expect(state.draft).toBe(start.draft);
  });

  it('is the text a save writes, without asking the writer', () => {
    const state = after(opened(), { type: 'set-text', text: TYPED });

    expect(textOf(state)).toBe(TYPED);
    expect(writeBlocker(state)).toBeUndefined();
    expect(isDirty(state)).toBe(true);
    expect(canSave(state)).toBe(true);
  });

  it('bumps the revision again for each further text', () => {
    const once = after(opened(), { type: 'set-text', text: TYPED });
    const twice = after(once, { type: 'set-text', text: `${TYPED}more\n` });

    expect(twice.revision).toBe(once.revision + 1);
    expect(rawTextOf(twice)).toBe(`${TYPED}more\n`);
  });

  it('is no edit when the text is the one already there', () => {
    const once = after(opened(), { type: 'set-text', text: TYPED });

    expect(reduce(once, { type: 'set-text', text: TYPED })).toBe(once);
  });

  it('is no edit when the text is the file as it stands', () => {
    const start = opened();

    expect(reduce(start, { type: 'set-text', text: HELLO_TEXT })).toBe(start);
  });

  it('is taken back by typing the file back, which leaves nothing to save', () => {
    const state = after(
      opened(),
      { type: 'set-text', text: TYPED },
      { type: 'set-text', text: HELLO_TEXT },
    );

    expect(rawTextOf(state)).toBeUndefined();
    expect(isDirty(state)).toBe(false);
  });

  it('freezes the keys of a stage, since the draft describes the file', () => {
    const start = opened();
    const state = after(start, { type: 'set-text', text: TYPED });
    const id = state.draft.stages[0]?.id ?? '';

    expect(changeBlocker(state)).toBe(RAW_EDIT_REASON);
    expect(reduce(state, { type: 'rename', id, name: 'drafting' })).toBe(state);
    expect(reduce(state, { type: 'set-agent', id, agent: 'k-tpm' })).toBe(
      state,
    );
    expect(reduce(state, { type: 'set-prompt', id, prompt: 'Go.' })).toBe(
      state,
    );
    expect(reduce(state, { type: 'add' })).toBe(state);
    expect(reduce(state, { type: 'remove', id })).toBe(state);
  });

  it('is refused while the file is being loaded again', () => {
    const loading = after(opened(), { type: 'reload' });

    expect(reduce(loading, { type: 'set-text', text: TYPED })).toBe(loading);
  });

  it('is refused on a read-only workflow', () => {
    const state = openDocument({ ...HELLO_DOCUMENT, readOnly: true });
    if (!state) throw new Error('The document must be editable.');

    expect(reduce(state, { type: 'set-text', text: TYPED })).toBe(state);
  });
});

describe('saving a raw edit', () => {
  const saved = () =>
    after(
      opened(),
      { type: 'set-text', text: TYPED },
      { type: 'save' },
      savedOf(TYPED),
    );

  it('makes that text the file and opens the draft from what was parsed', () => {
    const state = saved();

    expect(state.saved.text).toBe(TYPED);
    expect(state.saved.hash).toBe('c'.repeat(64));
    expect(state.save).toEqual({ phase: 'saved' });
    expect(rawTextOf(state)).toBeUndefined();
    expect(isDirty(state)).toBe(false);
    expect(changeBlocker(state)).toBeUndefined();
  });

  it('gives the draft the stages of the text that was written', () => {
    const state = saved();
    const names = state.draft.stages.map((stage) => stage.name);

    expect(names).toEqual(viewOfText(TYPED).stages.map((one) => one.name));
    expect(state.bases).toEqual(state.draft.stages.map((one) => one.id));
  });

  it('sends the text on the hash of the file it was typed over', () => {
    const state = after(opened(), { type: 'set-text', text: TYPED });

    expect(state.saved.hash).toBe(HELLO_DOCUMENT.hash);
    expect(textOf(state)).toBe(TYPED);
  });

  it('keeps the text to save again when the file changed underneath', () => {
    const state = after(
      opened(),
      { type: 'set-text', text: TYPED },
      { type: 'save' },
      { type: 'conflict' },
    );

    expect(state.save.phase).toBe('conflict');
    expect(rawTextOf(state)).toBe(TYPED);
    expect(canSave(state)).toBe(false);
  });

  it('offers the typed text to take away after a reload replaces it', () => {
    const state = after(
      opened(),
      { type: 'set-text', text: TYPED },
      { type: 'reload' },
      { type: 'reloaded', document: HELLO_DOCUMENT },
    );

    expect(state.discarded).toBe(TYPED);
    expect(rawTextOf(state)).toBeUndefined();
    expect(changeBlocker(state)).toBeUndefined();
  });

  it('takes a form edit again once the raw text is saved', () => {
    const state = saved();
    const id = state.draft.stages[0]?.id ?? '';
    const renamed = after(state, { type: 'rename', id, name: 'drafting' });

    expect(renamed.draft.stages[0]?.name).toBe('drafting');
    expect(isDirty(renamed)).toBe(true);
    expect(rawTextOf(renamed)).toBeUndefined();
  });

  it('answers the check of the revision the raw text was at', () => {
    const state = after(opened(), { type: 'set-text', text: TYPED });
    const checked = after(state, {
      type: 'checked',
      revision: state.revision,
      diagnostics: [],
    });

    expect(checked.check.revision).toBe(state.revision);
  });
});
