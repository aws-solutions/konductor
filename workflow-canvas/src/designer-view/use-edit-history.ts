// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState } from 'react';
import {
  canRedo,
  canUndo,
  recordEdit,
  redo,
  startHistory,
  undo,
} from './edit-history';

export { undoShortcut, type ShortcutKey } from './undo-shortcut';

/** The edit history of one text, as `useEditHistory` gives it. */
export interface EditHistoryControls {
  /** The text now. */
  readonly text: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Records an edit that made `text`. A text equal to the current one is none. */
  record(text: string): void;
  undo(): void;
  redo(): void;
  /** Starts over with `text` and nothing to undo or redo, as for another file. */
  reset(text: string): void;
}

/**
 * Undo and redo over the texts of a workflow, with the history of
 * `edit-history.ts`. Each call gives the text to show next in `text`. A key
 * handler can map a press with `undoShortcut`, and call `preventDefault` only
 * when it acts on the answer, so every other key stays the browser's.
 */
export function useEditHistory(initialText: string): EditHistoryControls {
  const [history, setHistory] = useState(() => startHistory(initialText));
  const record = useCallback(
    (text: string) => setHistory((current) => recordEdit(current, text)),
    [],
  );
  const back = useCallback(() => setHistory(undo), []);
  const forward = useCallback(() => setHistory(redo), []);
  const reset = useCallback(
    (text: string) => setHistory(startHistory(text)),
    [],
  );
  return {
    text: history.current,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    record,
    undo: back,
    redo: forward,
    reset,
  };
}
