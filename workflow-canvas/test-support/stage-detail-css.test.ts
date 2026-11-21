// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { COLOUR_LITERAL, readStyleSheet } from './css-variables.ts';

const sheet = readStyleSheet(
  new URL('../src/execution/stage-detail.css', import.meta.url),
);

describe('stage-detail.css', () => {
  it('sets no colour, so the detail takes those of the pane it sits in', () => {
    expect(sheet.text).not.toMatch(COLOUR_LITERAL);
    expect(sheet.text).not.toMatch(/\bcolor\s*:|background\s*:/);
  });
});
