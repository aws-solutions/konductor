// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { NEXT_UI_QUERY, wantsNextUi } from './next-ui';

describe('wantsNextUi', () => {
  it('asks for the views being built with ?ui=next', () => {
    expect(wantsNextUi(`?${NEXT_UI_QUERY}`)).toBe(true);
  });

  it('asks for them beside another query', () => {
    expect(wantsNextUi('?theme=dark&ui=next')).toBe(true);
  });

  it.each([
    ['no query', ''],
    ['a question mark only', '?'],
    ['another query', '?ui=old'],
    ['no value', '?ui='],
    ['another key', '?next=ui'],
    ['another case', '?ui=NEXT'],
  ])('keeps the page as it is with %s', (_, search) => {
    expect(wantsNextUi(search)).toBe(false);
  });
});
