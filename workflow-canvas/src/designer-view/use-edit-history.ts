// SPDX-License-Identifier: Apache-2.0
import { useCallback, useState } from 'react';
import {
  canRedo,
  canUndo,
  recordEdit,
  redo,
  startHistory,
  undo,
  type EditKind,
} from './edit-history';

export { undoShortcut, type ShortcutKey } from './undo-shortcut';

/** The edit history of one text, as `useEditHistory` gives it. */
export interface EditHistoryControls {
  /** The text now. */
  readonly text: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoText: string | undefined;
  readonly redoText: string | undefined;
  readonly undoAdoptsText: boolean;
  readonly redoAdoptsText: boolean;
  /** Records an edit that made `text`. A text equal to the current one is none. */
  record(text: string, kind?: EditKind): void;
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
    (text: string, kind?: EditKind) =>
      setHistory((current) => recordEdit(current, text, kind)),
    [],
  );
  const back = useCallback(() => setHistory(undo), []);
  const forward = useCallback(() => setHistory(redo), []);
  const reset = useCallback(
    (text: string) => setHistory(startHistory(text)),
    [],
  );
  return {
    text: history.current.text,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undoText: history.past.at(-1)?.text,
    redoText: history.future[0]?.text,
    undoAdoptsText: history.current.kind === 'text',
    redoAdoptsText: history.future[0]?.kind === 'text',
    record,
    undo: back,
    redo: forward,
    reset,
  };
}
