// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { undoShortcut, type ShortcutKey } from './undo-shortcut';

const press = (
  key: string,
  change: Partial<ShortcutKey> = {},
): ShortcutKey => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  keyCode: 90,
  ...change,
});

describe('undoShortcut', () => {
  it.each([
    ['Ctrl+Z', press('z', { ctrlKey: true }), 'undo'],
    ['Cmd+Z', press('z', { metaKey: true }), 'undo'],
    ['Ctrl+Z with Caps Lock', press('Z', { ctrlKey: true }), 'undo'],
    ['Ctrl+Shift+Z', press('Z', { ctrlKey: true, shiftKey: true }), 'redo'],
    ['Cmd+Shift+Z', press('Z', { metaKey: true, shiftKey: true }), 'redo'],
    ['Ctrl+Y', press('y', { ctrlKey: true }), 'redo'],
  ] as const)('reads %s as %s', (_, event, action) => {
    expect(undoShortcut(event)).toBe(action);
  });

  it.each([
    ['Z alone', press('z')],
    ['Shift+Z', press('Z', { shiftKey: true })],
    ['Ctrl+Alt+Z', press('z', { ctrlKey: true, altKey: true })],
    ['Cmd+Alt+Z', press('z', { metaKey: true, altKey: true })],
    ['Ctrl+Cmd+Z', press('z', { ctrlKey: true, metaKey: true })],
    ['Cmd+Y', press('y', { metaKey: true })],
    ['Ctrl+Shift+Y', press('Y', { ctrlKey: true, shiftKey: true })],
    ['Ctrl+X', press('x', { ctrlKey: true })],
    ['a held Ctrl+Z', press('z', { ctrlKey: true, repeat: true })],
    [
      'Ctrl+Z in a composition',
      press('z', { ctrlKey: true, isComposing: true }),
    ],
    ['the Process key of a composition', press('Process', { ctrlKey: true })],
    [
      'the key that ends a composition, sent after it with the key code 229',
      press('z', { ctrlKey: true, isComposing: false, keyCode: 229 }),
    ],
  ])('leaves %s to the browser', (_, event) => {
    expect(undoShortcut(event)).toBeUndefined();
  });
});
