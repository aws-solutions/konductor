// SPDX-License-Identifier: Apache-2.0

/** The fields of a keyboard event that the shortcut reads. */
export interface ShortcutKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /** True for the repeats of a key held down. */
  readonly repeat: boolean;
  /** True while an input method is composing text. */
  readonly isComposing: boolean;
  /** 229 for a key that an input method takes. */
  readonly keyCode: number;
}

// The key code of a key that an input method takes. Safari can send the
// keydown that ends a composition after `compositionend`, with `isComposing`
// false and this code.
const COMPOSING_KEY_CODE = 229;

/**
 * What a key press asks of the edit history: Ctrl+Z or Cmd+Z is `undo`, and
 * Ctrl+Shift+Z, Cmd+Shift+Z or Ctrl+Y is `redo`. Anything else is
 * `undefined` and left to the browser: a press with Alt, or with both Ctrl
 * and Cmd, a key held down so it repeats, and a key pressed inside an input
 * method composition, which some browsers report as the key `Process` or the
 * key code 229.
 */
export function undoShortcut(event: ShortcutKey): 'undo' | 'redo' | undefined {
  if (
    event.isComposing ||
    event.key === 'Process' ||
    event.keyCode === COMPOSING_KEY_CODE ||
    event.repeat
  ) {
    return undefined;
  }
  if (event.altKey || event.ctrlKey === event.metaKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && event.ctrlKey && !event.shiftKey) return 'redo';
  return undefined;
}
