// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { shownStage } from './run-floor';
import type { FollowedRun, FollowedStage } from './run-follow';

const stage = (
  name: string,
  status: FollowedStage['status'] = 'pending',
): FollowedStage => ({ name, status, console: [], dropped: false });

const runOf = (...stages: FollowedStage[]): FollowedRun => ({
  stages,
  next: 0,
  consoleOrder: [],
});

describe('shownStage', () => {
  it('is the picked stage while the run has it', () => {
    const run = runOf(stage('a', 'passed'), stage('b', 'running'));

    expect(shownStage(run, 'a')?.name).toBe('a');
  });

  it('is the stage at work when none was picked, or the pick is gone', () => {
    const run = runOf(stage('a', 'passed'), stage('b', 'running'));

    expect(shownStage(run, undefined)?.name).toBe('b');
    expect(shownStage(run, 'gone')?.name).toBe('b');
  });

  it('is the blocked stage when none is at work', () => {
    const run = runOf(stage('a', 'passed'), stage('b', 'blocked'), stage('c'));

    expect(shownStage(run, undefined)?.name).toBe('b');
  });

  it('is the first stage otherwise, and undefined for a run with none', () => {
    expect(shownStage(runOf(stage('a'), stage('b')), undefined)?.name).toBe(
      'a',
    );
    expect(shownStage(runOf(), undefined)).toBeUndefined();
  });
});
