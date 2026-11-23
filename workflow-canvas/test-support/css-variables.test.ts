// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { COLOUR_LITERAL, parseStyleSheet } from './css-variables.ts';

const SHEET = parseStyleSheet(`
/* #123456 in a comment */
.wf-x {
  --wf-x-text: #16131f;
  --wf-x-bg:   #ffffff ;
  color: var(--wf-x-text);
}

:root[data-theme='dark'] .wf-x {
  --wf-x-text: #f5f3ee;
}

.wf-x-part {
  color: #ff0000;
}
`);

describe('parseStyleSheet', () => {
  it('reads the variables of a rule, trimmed', () => {
    expect(SHEET.declarations('.wf-x')).toEqual({
      '--wf-x-text': '#16131f',
      '--wf-x-bg': '#ffffff',
    });
    expect(SHEET.declarations(":root[data-theme='dark'] .wf-x")).toEqual({
      '--wf-x-text': '#f5f3ee',
    });
  });

  it('drops the comments and the variable blocks, and keeps the other rules', () => {
    const outside = SHEET.outside('.wf-x');

    expect(outside).not.toContain('#123456');
    expect(outside).not.toContain('#16131f');
    expect(outside).not.toContain('#f5f3ee');
    expect(outside).toMatch(COLOUR_LITERAL);
    expect(outside).toContain('.wf-x-part');
  });
});
