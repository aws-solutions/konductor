// SPDX-License-Identifier: Apache-2.0

/**
 * The most earlier texts kept for undo. A file may have up to 262,144 bytes,
 * so the history holds at most about 13 million characters.
 */
export const EDIT_HISTORY_LIMIT = 50;

/** How an edit changed the workflow text. */
export type EditKind = 'stages' | 'text';

/** One text in the edit history and the path that produced it. */
export interface EditPoint {
  readonly text: string;
  readonly kind: EditKind;
  readonly paramCount?: number;
}

/**
 * The text of a workflow now, with the texts to undo to and to redo. No
 * function here changes a history: one that changes it returns a new one,
 * and one with nothing to do returns the history it was given.
 */
export interface EditHistory {
  /** The earlier texts, oldest first. */
  readonly past: readonly EditPoint[];
  readonly current: EditPoint;
  /** The texts that undo left, the next one to redo first. */
  readonly future: readonly EditPoint[];
}

/** A history with `text` and nothing to undo or redo. */
export function startHistory(text: string, paramCount?: number): EditHistory {
  return {
    past: [],
    current: { text, kind: 'stages', paramCount },
    future: [],
  };
}

/**
 * The history after an edit that made `text`. The edit clears the redo list,
 * and past `EDIT_HISTORY_LIMIT` earlier texts the oldest goes. A text equal
 * to the current one is no edit, and the same history comes back.
 */
export function recordEdit(
  history: EditHistory,
  text: string,
  kind: EditKind = 'stages',
  paramCount?: number,
): EditHistory {
  if (text === history.current.text) return history;
  return {
    past: [...history.past, history.current].slice(-EDIT_HISTORY_LIMIT),
    current: { text, kind, paramCount },
    future: [],
  };
}

/** Whether there is an earlier text to go back to. */
export function canUndo(history: EditHistory): boolean {
  return history.past.length > 0;
}

/** Whether there is a text that undo left. */
export function canRedo(history: EditHistory): boolean {
  return history.future.length > 0;
}

/** The history one text back, or the same history when there is none. */
export function undo(history: EditHistory): EditHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    current: previous,
    future: [history.current, ...history.future],
  };
}

/** The history one text forward, or the same history when there is none. */
export function redo(history: EditHistory): EditHistory {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    past: [...history.past, history.current],
    current: next,
    future: rest,
  };
}
