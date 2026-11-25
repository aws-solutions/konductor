// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { WorkflowChecks } from '../../api/types';
import type { FollowedRun, FollowedStage } from './run-follow';
import {
  checkRows,
  checkStateWord,
  checksRereadKey,
  isVerified,
  stageCheckRows,
} from './run-checks';

const ORDER = ['draft', 'review'];

const DECLARED: WorkflowChecks = {
  declared: [
    { id: 'readme-exists', kind: 'file' },
    { id: 'tests-pass', kind: 'run' },
  ],
  doneWhen: { draft: ['readme-exists'], review: ['readme-exists'] },
};

const stage = (name: string, status: FollowedStage['status']): FollowedStage =>
  ({ name, status, console: [], dropped: false }) as FollowedStage;

const followed = (...stages: FollowedStage[]): FollowedRun =>
  ({ stages, next: 0, consoleOrder: [] }) as FollowedRun;

describe('checkRows', () => {
  it('lists the declared checks in the order of the file', () => {
    const rows = checkRows(DECLARED, {}, ORDER);

    expect(rows.map((row) => row.id)).toEqual(['readme-exists', 'tests-pass']);
  });

  it('takes the state the run reports', () => {
    const rows = checkRows(
      DECLARED,
      { 'readme-exists': 'verified', 'tests-pass': 'deferred' },
      ORDER,
    );

    expect(rows.map((row) => [row.state, row.verified])).toEqual([
      ['verified', true],
      ['deferred', false],
    ]);
  });

  it('defers a check that the run does not name', () => {
    const [row] = checkRows(DECLARED, {}, ORDER);

    expect(row?.state).toBe('deferred');
    expect(row?.verified).toBe(false);
  });

  it('counts a state it does not know as not verified, and keeps the word', () => {
    const [row] = checkRows(DECLARED, { 'readme-exists': 'reported' }, ORDER);

    expect(row?.state).toBe('reported');
    expect(row?.verified).toBe(false);
  });

  it('reads a state as an own key only', () => {
    const inherited = {
      declared: [{ id: 'constructor' as const, kind: 'file' as const }],
      doneWhen: {},
    };

    expect(checkRows(inherited, {}, ORDER)[0]?.state).toBe('deferred');
  });

  it('names the stages that wait for a check, in run order', () => {
    const rows = checkRows(DECLARED, {}, ORDER);

    expect(rows[0]?.stages).toEqual(['draft', 'review']);
    expect(rows[1]?.stages).toEqual([]);
  });

  it('lists nothing for a workflow that declares no check', () => {
    expect(checkRows(undefined, {}, ORDER)).toEqual([]);
  });
});

describe('stageCheckRows', () => {
  it('gives a stage the checks its done_when names', () => {
    const rows = checkRows(DECLARED, {}, ORDER);

    expect(stageCheckRows('draft', rows).map((row) => row.id)).toEqual([
      'readme-exists',
    ]);
  });

  it('gives a stage that names none nothing', () => {
    const rows = checkRows(
      { declared: DECLARED.declared, doneWhen: {} },
      {},
      ORDER,
    );

    expect(stageCheckRows('draft', rows)).toEqual([]);
  });
});

describe('checkStateWord', () => {
  it('shows the state the run reports, with a capital', () => {
    expect(checkStateWord('verified')).toBe('Verified');
    expect(checkStateWord('deferred')).toBe('Deferred');
  });

  it('shows a word it does not know as it came', () => {
    expect(checkStateWord('reported')).toBe('Reported');
  });
});

describe('isVerified', () => {
  it('is true only for the state that says the check was run', () => {
    expect(isVerified('verified')).toBe(true);
    expect(isVerified('deferred')).toBe(false);
    expect(isVerified('reported')).toBe(false);
  });
});

describe('checksRereadKey', () => {
  it('reads nothing without a run', () => {
    expect(checksRereadKey(undefined, undefined, false)).toBeUndefined();
  });

  it('changes when a stage passes', () => {
    const before = checksRereadKey(
      'r1',
      followed(stage('draft', 'running'), stage('review', 'pending')),
      false,
    );
    const after = checksRereadKey(
      'r1',
      followed(stage('draft', 'passed'), stage('review', 'running')),
      false,
    );

    expect(after).not.toBe(before);
  });

  it('stays the same while one stage goes on', () => {
    const run = followed(stage('draft', 'running'), stage('review', 'pending'));

    expect(checksRereadKey('r1', run, false)).toBe(
      checksRereadKey('r1', run, false),
    );
  });

  it('changes when the run ends', () => {
    const run = followed(stage('draft', 'passed'), stage('review', 'passed'));

    expect(checksRereadKey('r1', run, true)).not.toBe(
      checksRereadKey('r1', run, false),
    );
  });

  it('changes for another run', () => {
    const run = followed(stage('draft', 'running'));

    expect(checksRereadKey('r2', run, false)).not.toBe(
      checksRereadKey('r1', run, false),
    );
  });
});
