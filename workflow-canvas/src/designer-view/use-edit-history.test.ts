// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EDIT_HISTORY_LIMIT } from './edit-history';
import { useEditHistory } from './use-edit-history';

function renderHistory(text = 'v0') {
  return renderHook(() => useEditHistory(text));
}

describe('useEditHistory', () => {
  it('starts with the text and nothing to undo or redo', () => {
    const { result } = renderHistory();

    expect(result.current.text).toBe('v0');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('records edits, and undoes and redoes them in order', () => {
    const { result } = renderHistory();
    act(() => result.current.record('v1'));
    act(() => result.current.record('v2'));

    expect(result.current.text).toBe('v2');
    act(() => result.current.undo());
    expect(result.current.text).toBe('v1');
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.text).toBe('v0');
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.text).toBe('v1');
  });

  it('marks undo and redo through whole-text edits for adoption', () => {
    const { result } = renderHistory();
    act(() => result.current.record('v1'));
    act(() => result.current.record('v2', 'text'));

    expect(result.current.undoText).toBe('v1');
    expect(result.current.undoAdoptsText).toBe(true);
    act(() => result.current.undo());
    expect(result.current.redoText).toBe('v2');
    expect(result.current.redoAdoptsText).toBe(true);
  });

  it('applies two calls in one batch in order', () => {
    const { result } = renderHistory();
    act(() => {
      result.current.record('v1');
      result.current.record('v2');
      result.current.undo();
    });

    expect(result.current.text).toBe('v1');
    expect(result.current.canRedo).toBe(true);
  });

  it('clears redo on a new edit, and skips an edit equal to the text', () => {
    const { result } = renderHistory();
    act(() => result.current.record('v1'));
    act(() => result.current.undo());
    act(() => result.current.record('v0'));

    expect(result.current.canRedo).toBe(true);
    act(() => result.current.record('v0b'));
    expect(result.current.canRedo).toBe(false);
  });

  it('does nothing for an undo or a redo with nothing to do', () => {
    const { result } = renderHistory();
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(result.current.text).toBe('v0');
  });

  it('keeps text and parameter-count metadata within the history limit', () => {
    const { result } = renderHistory();
    act(() => {
      for (let i = 1; i <= EDIT_HISTORY_LIMIT + 3; i += 1) {
        result.current.record(`v${i}`, 'stages', i);
      }
    });
    act(() => {
      for (let i = 0; i < EDIT_HISTORY_LIMIT + 3; i += 1) result.current.undo();
    });

    expect(result.current.text).toBe('v3');
    expect(result.current.paramCount).toBe(3);
    expect(result.current.canUndo).toBe(false);
  });

  it('starts over on reset', () => {
    const { result } = renderHistory();
    act(() => result.current.record('v1'));
    act(() => result.current.reset('other file'));

    expect(result.current.text).toBe('other file');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('keeps its functions the same from one render to the next', () => {
    const { result } = renderHistory();
    const first = result.current;
    act(() => result.current.record('v1'));

    expect(result.current.record).toBe(first.record);
    expect(result.current.undo).toBe(first.undo);
    expect(result.current.redo).toBe(first.redo);
    expect(result.current.reset).toBe(first.reset);
  });
});
