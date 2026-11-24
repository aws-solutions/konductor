// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { CLASSIC_UI_QUERY, wantsClassicUi } from './next-ui';

describe('wantsClassicUi', () => {
  it('asks for the views the page replaced with ?ui=classic', () => {
    expect(wantsClassicUi(`?${CLASSIC_UI_QUERY}`)).toBe(true);
  });

  it('asks for them beside another query', () => {
    expect(wantsClassicUi('?theme=dark&ui=classic')).toBe(true);
  });

  it.each([
    ['no query', ''],
    ['a question mark only', '?'],
    ['the query the page used to need', '?ui=next'],
    ['another value', '?ui=old'],
    ['no value', '?ui='],
    ['another key', '?classic=ui'],
    ['another case', '?ui=CLASSIC'],
  ])('draws the views the page opens with, given %s', (_, search) => {
    expect(wantsClassicUi(search)).toBe(false);
  });
});
