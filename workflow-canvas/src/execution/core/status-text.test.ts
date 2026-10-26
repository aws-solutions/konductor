// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { helloRun } from '../../test-support/fixtures';
import { IDLE, reduce, type ExecutionState } from './execution-state';
import { statusKind, statusText } from './status-text';

const STARTING: ExecutionState = { phase: 'starting' };

function following(run?: ReturnType<typeof helloRun>): ExecutionState {
  return { phase: 'following', runId: helloRun(0).runId, run };
}

describe('statusText and statusKind', () => {
  it.each<[string, ExecutionState, string, string]>([
    ['idle', IDLE, 'Ready. Press Run to start.', 'idle'],
    ['starting', STARTING, 'Starting the run.', 'busy'],
    [
      'following with no reading yet',
      following(),
      'Waiting for the first status of the run.',
      'busy',
    ],
    [
      'the first stage running',
      following(helloRun(0)),
      'Running draft. 0 of 2 stages done.',
      'busy',
    ],
    [
      'the second stage running',
      following(helloRun(1)),
      'Running review. 1 of 2 stages done.',
      'busy',
    ],
    [
      'a run that passed',
      { phase: 'finished', run: helloRun(2) },
      'Run passed. 2 of 2 stages done. Exit code 0.',
      'success',
    ],
    [
      'a run that halted',
      { phase: 'finished', run: helloRun(0, { blockedAt: 1 }) },
      'Run halted at review. 1 of 2 stages done. Exit code 1.',
      'error',
    ],
    [
      'an error before the run started',
      { phase: 'error', message: 'x', started: false },
      'The run did not start.',
      'error',
    ],
    [
      'an error after the run started',
      { phase: 'error', message: 'x', started: true },
      'Stopped following the run.',
      'error',
    ],
  ])('says %s', (_, state, text, kind) => {
    expect(statusText(state)).toBe(text);
    expect(statusKind(state)).toBe(kind);
  });

  it('says it is waiting between two stages', () => {
    const between = {
      ...helloRun(0),
      stages: [
        { name: 'draft', status: 'passed' as const },
        { name: 'review', status: 'pending' as const },
      ],
    };

    expect(statusText(following(between))).toBe(
      'Waiting for the next stage. 1 of 2 stages done.',
    );
  });

  it('leaves out the exit code when the reply has none', () => {
    const run = { ...helloRun(2), exitCode: null };

    expect(statusText({ phase: 'finished', run })).toBe(
      'Run passed. 2 of 2 stages done.',
    );
  });

  it('does not name a stage when a halted run has no failed one', () => {
    const run = { ...helloRun(0, { blockedAt: 0 }), stages: [] };

    expect(statusText({ phase: 'finished', run })).toBe(
      'Run halted. 0 of 0 stages done. Exit code 1.',
    );
  });

  it('follows a whole run from the first click to the end', () => {
    const states = [
      reduce(IDLE, { type: 'start' }),
      reduce(STARTING, { type: 'started', runId: helloRun(0).runId }),
    ];

    expect(states.map(statusText)).toEqual([
      'Starting the run.',
      'Waiting for the first status of the run.',
    ]);
  });
});
