// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { HELLO_VIEW } from '../test-support/fixtures';
import { clippedStages, textWidth } from './clipping';

describe('textWidth', () => {
  it('counts a lower case Latin letter as 1', () => {
    expect(textWidth('draft')).toBe(5);
  });

  it('counts a Chinese, Japanese or Korean character as 2', () => {
    expect(textWidth('日本語')).toBe(6);
    expect(textWidth('ひらがな')).toBe(8);
    expect(textWidth('한국어')).toBe(6);
  });

  it('counts an emoji as 2, whole, not as two halves', () => {
    expect(textWidth('🚀')).toBe(2);
  });

  it('counts a capital as wider than a lower case letter', () => {
    expect(textWidth('AB')).toBeGreaterThan(textWidth('ab'));
  });
});

describe('clippedStages', () => {
  it('finds no stage in a workflow whose text fits', () => {
    expect(clippedStages(HELLO_VIEW, 'kiro-cli')).toEqual([]);
  });

  it('finds a stage whose name is too wide, though it has few characters', () => {
    const view = {
      ...HELLO_VIEW,
      stages: [{ name: '日本語の長いステージ名です', agent: 'a' }],
    };

    expect(clippedStages(view, 'kiro-cli')).toHaveLength(1);
  });

  it('finds a stage whose agent and harness do not fit one line', () => {
    const view = {
      ...HELLO_VIEW,
      stages: [{ name: 'draft', agent: 'a'.repeat(40) }],
    };

    expect(clippedStages(view, 'kiro-cli')).toHaveLength(1);
  });
});
