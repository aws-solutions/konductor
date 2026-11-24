// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { helloRun } from '../../test-support/fixtures';
import { blockedStageOf, reasonSentence } from './stage-reason';

describe('reasonSentence', () => {
  it.each([
    'RESULT_MISSING',
    'RESULT_INVALID',
    'RESULT_FAILURE',
    'SESSION_FAILED',
    'TIMEOUT',
    'OUTPUT_MISSING',
    'OUTPUT_UNCHANGED',
    'CHECK_FAILED',
  ])('says what %s means in one sentence', (code) => {
    expect(reasonSentence(code)).toMatch(/^[A-Z][^.]*\.$/);
  });

  it.each(['OUT_OF_CREDIT', '', 'toString', '__proto__'])(
    'has no sentence for a code it does not know, such as %j',
    (code) => {
      expect(reasonSentence(code)).toBeUndefined();
    },
  );
});

describe('blockedStageOf', () => {
  it('is the stage that stopped the run, with its reason', () => {
    expect(
      blockedStageOf(helloRun(0, { blockedAt: 1, reason: 'TIMEOUT' })),
    ).toEqual({ name: 'review', reason: 'TIMEOUT' });
  });

  it('is the stage that stopped the run alone when the reply gave no reason', () => {
    const run = helloRun(0, { blockedAt: 1 });
    const noReason = {
      ...run,
      stages: run.stages.map(({ name, status }) => ({ name, status })),
    };

    expect(blockedStageOf(noReason)).toEqual({ name: 'review' });
  });

  it('is undefined for a run that is going or passed, or no run', () => {
    expect(blockedStageOf(helloRun(0))).toBeUndefined();
    expect(blockedStageOf(helloRun(2))).toBeUndefined();
    expect(blockedStageOf(undefined)).toBeUndefined();
  });
});
