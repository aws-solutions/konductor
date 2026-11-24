// SPDX-License-Identifier: Apache-2.0

/** The query that asks for the views the page replaced: `?ui=classic`. */
export const CLASSIC_UI_QUERY = 'ui=classic';

const UI_KEY = 'ui';
const CLASSIC_UI_VALUE = 'classic';

/**
 * Whether the address asks for the views the page replaced, with
 * `?ui=classic`. Any other value of `ui`, and no `ui` at all, draws the
 * views the page now opens with. A query that cannot be read is no ask.
 */
export function wantsClassicUi(search: string): boolean {
  try {
    return new URLSearchParams(search).get(UI_KEY) === CLASSIC_UI_VALUE;
  } catch {
    return false;
  }
}
