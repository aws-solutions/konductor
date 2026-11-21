// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { FollowedStage } from './run-follow';
import { blockedText, stageStateWord } from './stage-detail';

const stage = (change: Partial<FollowedStage>): FollowedStage => ({
  name: 'draft',
  status: 'blocked',
  console: [],
  dropped: false,
  ...change,
});

const sentences: Record<string, string> = {
  TIMEOUT: 'The stage ran out of time.',
};
const reasonSentence = (code: string) => sentences[code];

describe('stageStateWord', () => {
  it.each([
    ['pending', false, 'Queued'],
    ['pending', true, 'Not run'],
    ['running', false, 'Running'],
    ['running', true, 'Not finished'],
    ['passed', true, 'Passed'],
    ['blocked', true, 'Blocked'],
  ] as const)(
    'says a %s stage (run finished: %s) is %s',
    (status, finished, word) => {
      expect(stageStateWord(status, finished)).toBe(word);
    },
  );
});

describe('blockedText', () => {
  it('is the sentence for the reason of a blocked stage', () => {
    expect(blockedText(stage({ reason: 'TIMEOUT' }), reasonSentence)).toBe(
      'The stage ran out of time.',
    );
  });

  it('names a reason code it has no sentence for', () => {
    expect(blockedText(stage({ reason: 'LATER_CODE' }), reasonSentence)).toBe(
      'The stage stopped the run with the reason LATER_CODE.',
    );
  });

  it('says the stage stopped the run when no reason came', () => {
    expect(blockedText(stage({}), reasonSentence)).toBe(
      'The stage stopped the run.',
    );
  });

  it.each(['pending', 'running', 'passed'] as const)(
    'is undefined for a %s stage',
    (status) => {
      expect(blockedText(stage({ status }), reasonSentence)).toBeUndefined();
    },
  );
});
