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
  RAW_SAVE_REASON,
  rawTextOf,
  SAVING_REASON,
  textBlocker,
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

describe('typing while a save is going on', () => {
  const NEWER = `${TYPED}# newer\n`;

  const sendingForm = () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    return after(
      start,
      { type: 'rename', id, name: 'drafting' },
      {
        type: 'save',
      },
    );
  };

  const sendingRaw = () =>
    after(opened(), { type: 'set-text', text: TYPED }, { type: 'save' });

  it('is refused while a form save is on its way, with the reason', () => {
    const sending = sendingForm();
    expect(sending.submitted?.kind).toBe('form');

    expect(textBlocker(sending)).toBe(SAVING_REASON);
    expect(reduce(sending, { type: 'set-text', text: TYPED })).toBe(sending);
  });

  it('is refused while a raw save is on its way, with the reason', () => {
    const sending = sendingRaw();
    expect(sending.submitted).toMatchObject({ kind: 'raw', text: TYPED });

    expect(textBlocker(sending)).toBe(SAVING_REASON);
    expect(reduce(sending, { type: 'set-text', text: NEWER })).toBe(sending);
    expect(reduce(sending, { type: 'set-text', text: HELLO_TEXT })).toBe(
      sending,
    );
  });

  it('shows what the file holds once a raw save has worked', () => {
    const state = after(sendingRaw(), savedOf(TYPED));

    expect(state.saved.text).toBe(TYPED);
    expect(textOf(state)).toBe(TYPED);
    expect(rawTextOf(state)).toBeUndefined();
    expect(isDirty(state)).toBe(false);
    expect(textBlocker(state)).toBeUndefined();
    expect(state.check.revision).toBe(state.revision);
  });

  it('keeps the text to save again when a raw save fails', () => {
    const state = after(sendingRaw(), {
      type: 'failed',
      message: 'The server said no.',
    });

    expect(state.saved.text).toBe(HELLO_TEXT);
    expect(textOf(state)).toBe(TYPED);
    expect(rawTextOf(state)).toBe(TYPED);
    expect(isDirty(state)).toBe(true);
    expect(textBlocker(state)).toBeUndefined();
  });

  it('keeps the text to copy when the file changed under a raw save', () => {
    const state = after(sendingRaw(), { type: 'conflict' });

    expect(state.saved.text).toBe(HELLO_TEXT);
    expect(textOf(state)).toBe(TYPED);
    expect(state.save.phase).toBe('conflict');
    expect(canSave(state)).toBe(false);
    // Typing is open again, so the text can be put somewhere safe.
    expect(textBlocker(state)).toBeUndefined();
  });

  it('shows the form draft again once a form save has worked', () => {
    const sending = sendingForm();
    const formText = sending.submitted?.text ?? '';
    const state = after(sending, savedOf(formText));

    expect(state.saved.text).toBe(formText);
    expect(textOf(state)).toBe(formText);
    expect(rawTextOf(state)).toBeUndefined();
    expect(textBlocker(state)).toBeUndefined();
  });

  it('takes a text again as soon as the answer has come', () => {
    const settled = after(sendingRaw(), savedOf(TYPED));
    const typed = after(settled, { type: 'set-text', text: NEWER });

    expect(rawTextOf(typed)).toBe(NEWER);
    expect(typed.save.phase).toBe('idle');
  });

  it('takes the answer of a form save as a form save', () => {
    const sending = sendingForm();
    const id = sending.draft.stages[0]?.id ?? '';
    const formText = sending.submitted?.text ?? '';
    const state = after(sending, savedOf(formText));

    // The ids of the form draft survive, so a later form save still edits in
    // place rather than starting over from a parse.
    expect(state.draft.stages[0]?.id).toBe(id);
    expect(state.draft.stages[0]?.name).toBe('drafting');
  });
});

describe('typing the loaded text over a form edit', () => {
  it('stays the text a save writes, so the form edit is dropped', () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    const renamed = after(start, { type: 'rename', id, name: 'drafting' });
    expect(textOf(renamed)).toContain('name: drafting');

    const state = after(renamed, { type: 'set-text', text: HELLO_TEXT });

    expect(rawTextOf(state)).toBe(HELLO_TEXT);
    expect(textOf(state)).toBe(HELLO_TEXT);
    expect(isDirty(state)).toBe(true);
  });

  it('leaves the file as it was once saved, and reopens from the parse', () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    const state = after(
      start,
      { type: 'rename', id, name: 'drafting' },
      { type: 'set-text', text: HELLO_TEXT },
      { type: 'save' },
    );
    expect(state.submitted).toMatchObject({ kind: 'raw', text: HELLO_TEXT });

    const written = after(state, savedOf(HELLO_TEXT));

    expect(written.saved.text).toBe(HELLO_TEXT);
    expect(written.draft.stages[0]?.name).toBe('draft');
    expect(rawTextOf(written)).toBeUndefined();
    expect(isDirty(written)).toBe(false);
  });

  it('is no edit when the form draft is clean, since that text is the file', () => {
    const start = opened();

    expect(reduce(start, { type: 'set-text', text: HELLO_TEXT })).toBe(start);
  });

  it('is no edit when the text is the one the form draft would write', () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    const renamed = after(start, { type: 'rename', id, name: 'drafting' });
    const written = textOf(renamed) ?? '';

    expect(reduce(renamed, { type: 'set-text', text: written })).toBe(renamed);
  });
});

describe('a raw edit taken back', () => {
  it('leaves nothing behind, so the next form edit is what a save writes', () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    const cancelled = after(
      start,
      { type: 'set-text', text: TYPED },
      { type: 'set-text', text: HELLO_TEXT },
    );

    expect(cancelled.raw).toBeUndefined();
    expect(Object.hasOwn(cancelled, 'raw')).toBe(false);
    expect(isDirty(cancelled)).toBe(false);
    expect(changeBlocker(cancelled)).toBeUndefined();

    const renamed = after(cancelled, {
      type: 'rename',
      id,
      name: 'drafting',
    });

    expect(textOf(renamed)).toContain('name: drafting');
    expect(textOf(renamed)).not.toBe(TYPED);
    expect(rawTextOf(renamed)).toBeUndefined();
  });

  it('sends the form edit, not the text that was typed and taken back', () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    const state = after(
      start,
      { type: 'set-text', text: TYPED },
      { type: 'set-text', text: HELLO_TEXT },
      { type: 'rename', id, name: 'drafting' },
      { type: 'save' },
    );

    expect(state.submitted?.kind).toBe('form');
    expect(state.submitted?.text).toContain('name: drafting');
    expect(state.submitted?.text).not.toBe(TYPED);
  });

  it('comes back to the form draft without a save in between', () => {
    const start = opened();
    const id = start.draft.stages[0]?.id ?? '';
    const renamed = after(start, { type: 'rename', id, name: 'drafting' });
    const formText = textOf(renamed) ?? '';
    const over = after(renamed, { type: 'set-text', text: TYPED });
    expect(changeBlocker(over)).toBe(RAW_EDIT_REASON);

    const back = after(over, { type: 'set-text', text: formText });

    expect(back.raw).toBeUndefined();
    expect(changeBlocker(back)).toBeUndefined();
    expect(textOf(back)).toBe(formText);
    // The form edit is still there to save.
    expect(back.draft.stages[0]?.name).toBe('drafting');
    expect(isDirty(back)).toBe(true);
  });

  it('bumps the revision, so the check runs for the text that is back', () => {
    const start = opened();
    const over = after(start, { type: 'set-text', text: TYPED });
    const back = after(over, { type: 'set-text', text: HELLO_TEXT });

    expect(back.revision).toBe(over.revision + 1);
  });
});

describe('a raw save that is still running', () => {
  const sending = () =>
    after(opened(), { type: 'set-text', text: TYPED }, { type: 'save' });

  it('keeps the keys of a stage shut until its answer arrives', () => {
    const state = sending();
    const id = state.draft.stages[0]?.id ?? '';

    expect(changeBlocker(state)).toBe(RAW_SAVE_REASON);
    expect(reduce(state, { type: 'rename', id, name: 'drafting' })).toBe(state);
    expect(reduce(state, { type: 'add' })).toBe(state);
  });

  it('takes no text at all, so nothing can be typed back to the file', () => {
    const state = sending();
    const id = state.draft.stages[0]?.id ?? '';

    expect(reduce(state, { type: 'set-text', text: HELLO_TEXT })).toBe(state);
    expect(state.raw).toBe(TYPED);
    expect(changeBlocker(state)).toBe(RAW_SAVE_REASON);
    expect(reduce(state, { type: 'rename', id, name: 'drafting' })).toBe(state);
  });

  it('writes the text it was sent, with no stale bytes left over', () => {
    const state = after(sending(), savedOf(TYPED));

    expect(state.saved.text).toBe(TYPED);
    expect(state.raw).toBeUndefined();
    expect(isDirty(state)).toBe(false);
    expect(changeBlocker(state)).toBeUndefined();
  });

  it('opens the keys of a stage again once the answer has come', () => {
    const state = after(sending(), savedOf(TYPED));
    const id = state.draft.stages[0]?.id ?? '';
    const renamed = after(state, { type: 'rename', id, name: 'drafting' });

    expect(renamed.draft.stages[0]?.name).toBe('drafting');
    expect(textOf(renamed)).toContain('name: drafting');
  });

  it('drops a text that the save made the same as the form draft', () => {
    const sendingForm = after(
      opened(),
      { type: 'set-text', text: TYPED },
      { type: 'save' },
    );
    const state = after(sendingForm, savedOf(TYPED));

    // The file now holds TYPED, so the draft would write it: nothing is left.
    expect(Object.hasOwn(state, 'raw')).toBe(false);
  });
});
