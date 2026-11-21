// SPDX-License-Identifier: Apache-2.0

/** The query that asks for the views being built: `?ui=next`. */
export const NEXT_UI_QUERY = 'ui=next';

const NEXT_UI_KEY = 'ui';
const NEXT_UI_VALUE = 'next';

/**
 * Whether the address asks for the views being built, with `?ui=next`. Any
 * other value of `ui`, and no `ui` at all, keeps the page as it is, so a
 * person who does not ask for them never sees them. A query that cannot be
 * read is no ask.
 */
export function wantsNextUi(search: string): boolean {
  try {
    return new URLSearchParams(search).get(NEXT_UI_KEY) === NEXT_UI_VALUE;
  } catch {
    return false;
  }
}
