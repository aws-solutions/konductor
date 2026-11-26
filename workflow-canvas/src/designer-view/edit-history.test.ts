// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  EDIT_HISTORY_LIMIT,
  recordEdit,
  redo,
  startHistory,
  undo,
  type EditHistory,
} from './edit-history';

function edited(...texts: string[]): EditHistory {
  return texts.reduce(
    (history, text) => recordEdit(history, text),
    startHistory('v0'),
  );
}

describe('edit history', () => {
  it('starts with nothing to undo or redo', () => {
    const history = startHistory('v0');

    expect(history.current.text).toBe('v0');
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('undoes and redoes edits in order', () => {
    const history = edited('v1', 'v2');
    const back = undo(undo(history));

    expect(back.current.text).toBe('v0');
    expect(canUndo(back)).toBe(false);
    expect(redo(back).current.text).toBe('v1');
    expect(redo(redo(back))).toEqual(history);
  });

  it('gives back the same history for an undo with nothing to undo', () => {
    const history = startHistory('v0');

    expect(undo(history)).toBe(history);
  });

  it('gives back the same history for a redo with nothing to redo', () => {
    const history = edited('v1');

    expect(redo(history)).toBe(history);
  });

  it('clears the redo list on a new edit', () => {
    const history = recordEdit(undo(edited('v1', 'v2')), 'v1b');

    expect(history.current.text).toBe('v1b');
    expect(canRedo(history)).toBe(false);
    expect(history.past.map(({ text }) => text)).toEqual(['v0', 'v1']);
  });

  it('skips a text equal to the current one, and keeps the redo list', () => {
    const history = undo(edited('v1', 'v2'));

    expect(recordEdit(history, 'v1')).toBe(history);
    expect(canRedo(history)).toBe(true);
  });

  it('keeps at most the limit of earlier texts, dropping the oldest', () => {
    const texts = Array.from(
      { length: EDIT_HISTORY_LIMIT + 5 },
      (_, i) => `v${i + 1}`,
    );
    const history = edited(...texts);

    expect(history.past).toHaveLength(EDIT_HISTORY_LIMIT);
    expect(history.past[0]?.text).toBe('v5');
    expect(history.past.at(-1)?.text).toBe(`v${EDIT_HISTORY_LIMIT + 4}`);

    let back = history;
    for (let i = 0; i < EDIT_HISTORY_LIMIT + 3; i += 1) back = undo(back);
    expect(back.current.text).toBe('v5');
    expect(back.future).toHaveLength(EDIT_HISTORY_LIMIT);
  });

  it('leaves the history it was given as it was', () => {
    const history = edited('v1');
    const copy = structuredClone(history);
    recordEdit(history, 'v2');
    undo(history);
    redo(undo(history));

    expect(history).toEqual(copy);
  });
});
