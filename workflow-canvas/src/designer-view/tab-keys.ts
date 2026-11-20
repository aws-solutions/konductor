// SPDX-License-Identifier: Apache-2.0

/** The fields of a keyboard event that a tab list reads. */
export interface TabKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * The tab a key moves to in a row of `count` tabs, with the tab at `index`
 * selected, as the WAI-ARIA tabs pattern has it: Left and Right move one tab
 * and wrap, Home and End go to the first and the last. Any other key, and any
 * key with a modifier, is `undefined` and left to the browser: Alt+Left is
 * Back, and Cmd or Ctrl with an arrow moves the caret or scrolls.
 */
export function tabKeyTarget(
  event: TabKey,
  index: number,
  count: number,
): number | undefined {
  if (count === 0) return undefined;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return undefined;
  }
  switch (event.key) {
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowRight':
      return (index + 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
