// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  canStartRun,
  followedRunId,
  goalIsOfThisRun,
  goalText,
  sameGoalSource,
  startDisabledReason,
  startNotice,
  startsOnEnter,
  UNFOLLOWED_RUN_REASON,
  type RunStart,
} from './run-start';

const RUN_ID = '20261024-0412-a7b3c';
const going: RunStart = { kind: 'going', runId: RUN_ID, joined: false };
const joined: RunStart = { kind: 'going', runId: RUN_ID, joined: true };

describe('followedRunId', () => {
  it('names the run that is going', () => {
    expect(followedRunId(going)).toBe(RUN_ID);
  });

  it.each<RunStart>([
    { kind: 'idle' },
    { kind: 'starting' },
    { kind: 'unsure', message: 'No answer.' },
    { kind: 'failed', message: 'No.' },
  ])('names no run for $kind', (start) => {
    expect(followedRunId(start)).toBeUndefined();
  });
});

describe('goalIsOfThisRun', () => {
  it('is true for a run this page started', () => {
    expect(goalIsOfThisRun(going, false)).toBe(true);
  });

  it('is false while a run that was already going goes on', () => {
    expect(goalIsOfThisRun(joined, false)).toBe(false);
  });

  it('is true once that run has ended, so the box and Run agree', () => {
    expect(goalIsOfThisRun(joined, true)).toBe(true);
  });

  it('is true while there is no run', () => {
    expect(goalIsOfThisRun({ kind: 'idle' }, false)).toBe(true);
  });
});

describe('canStartRun', () => {
  const problem = undefined;

  it('starts from idle with a goal the API takes', () => {
    expect(
      canStartRun({
        start: { kind: 'idle' },
        runFinished: false,
        goalProblem: problem,
      }),
    ).toBe(true);
  });

  it('starts again after a start that failed', () => {
    expect(
      canStartRun({
        start: { kind: 'failed', message: 'No.' },
        runFinished: false,
        goalProblem: problem,
      }),
    ).toBe(true);
  });

  it('does not start while a run goes on', () => {
    expect(
      canStartRun({ start: going, runFinished: false, goalProblem: problem }),
    ).toBe(false);
  });

  it('starts another run once the one followed has ended', () => {
    expect(
      canStartRun({ start: going, runFinished: true, goalProblem: problem }),
    ).toBe(true);
  });

  it('does not start while a start is in flight', () => {
    expect(
      canStartRun({
        start: { kind: 'starting' },
        runFinished: false,
        goalProblem: problem,
      }),
    ).toBe(false);
  });

  it('does not start when the last start may have run the workflow', () => {
    expect(
      canStartRun({
        start: { kind: 'unsure', message: 'No answer.' },
        runFinished: false,
        goalProblem: problem,
      }),
    ).toBe(false);
  });

  it('does not start with a goal the API refuses', () => {
    expect(
      canStartRun({
        start: { kind: 'idle' },
        runFinished: false,
        goalProblem: 'Enter a goal to run.',
      }),
    ).toBe(false);
  });
});

describe('startDisabledReason', () => {
  it('says nothing when Run can be pressed', () => {
    expect(
      startDisabledReason({
        start: { kind: 'idle' },
        runFinished: false,
        goalProblem: undefined,
      }),
    ).toBeUndefined();
  });

  it('names the goal problem when the goal is the reason', () => {
    expect(
      startDisabledReason({
        start: { kind: 'idle' },
        runFinished: false,
        goalProblem: 'Enter a goal to run.',
      }),
    ).toBe('Enter a goal to run.');
  });

  it('says a run is in progress while one goes on', () => {
    expect(
      startDisabledReason({
        start: going,
        runFinished: false,
        goalProblem: undefined,
      }),
    ).toBe('A run is in progress.');
  });

  it('says how to get going again when the follower of the run gave up', () => {
    expect(
      startDisabledReason({
        start: going,
        runFinished: false,
        goalProblem: undefined,
        followFailed: true,
      }),
    ).toBe(UNFOLLOWED_RUN_REASON);
    expect(UNFOLLOWED_RUN_REASON).toContain('Follow it again');
    expect(UNFOLLOWED_RUN_REASON).toContain('reload');
  });

  it('keeps Run shut while the run may still be going on the server', () => {
    expect(
      canStartRun({ start: going, runFinished: false, goalProblem: undefined }),
    ).toBe(false);
  });

  it('names the goal problem once the run it followed has ended', () => {
    expect(
      startDisabledReason({
        start: going,
        runFinished: true,
        goalProblem: 'Enter a goal to run.',
      }),
    ).toBe('Enter a goal to run.');
  });

  it('names the goal problem of a run that was already going and has ended', () => {
    expect(
      startDisabledReason({
        start: joined,
        runFinished: true,
        goalProblem: 'Enter a goal to run.',
      }),
    ).toBe('Enter a goal to run.');
  });

  it('asks for a reload when the last start is unsure', () => {
    expect(
      startDisabledReason({
        start: { kind: 'unsure', message: 'No answer.' },
        runFinished: false,
        goalProblem: undefined,
      }),
    ).toContain('Reload the page');
  });
});

describe('canStartRun and startDisabledReason, the params', () => {
  const idle = { start: { kind: 'idle' } as RunStart, runFinished: false };

  it('starts when the params are ones the API takes', () => {
    expect(
      canStartRun({
        ...idle,
        goalProblem: undefined,
        paramsProblem: undefined,
      }),
    ).toBe(true);
  });

  it('does not start while a param stops it', () => {
    expect(
      canStartRun({
        ...idle,
        goalProblem: undefined,
        paramsProblem: 'Enter a value for diff_input to run.',
      }),
    ).toBe(false);
  });

  it('says why the params stop it', () => {
    expect(
      startDisabledReason({
        ...idle,
        goalProblem: undefined,
        paramsProblem: 'Enter a value for diff_input to run.',
      }),
    ).toBe('Enter a value for diff_input to run.');
  });

  it('says the goal first, the box a person fills in first', () => {
    expect(
      startDisabledReason({
        ...idle,
        goalProblem: 'Enter a goal to run.',
        paramsProblem: 'Enter a value for diff_input to run.',
      }),
    ).toBe('Enter a goal to run.');
  });

  it('says a run is in progress before either box', () => {
    expect(
      startDisabledReason({
        start: going,
        runFinished: false,
        goalProblem: undefined,
        paramsProblem: 'Enter a value for diff_input to run.',
      }),
    ).toBe('A run is in progress.');
  });
});

describe('sameGoalSource', () => {
  const source = {
    start: () => undefined,
    list: () => undefined,
    goalDefault: 'Say hello',
    declared: [{ name: 'diff_input', required: false }],
  };

  it('is the same workflow for the same calls, default goal and params', () => {
    expect(sameGoalSource({ ...source }, source)).toBe(true);
  });

  it('is another workflow when the start call changes', () => {
    expect(sameGoalSource({ ...source, start: () => undefined }, source)).toBe(
      false,
    );
  });

  it('is another workflow when the list call changes', () => {
    expect(sameGoalSource({ ...source, list: () => undefined }, source)).toBe(
      false,
    );
  });

  it('is another workflow when the default goal changes', () => {
    expect(
      sameGoalSource({ ...source, goalDefault: 'Fix the build' }, source),
    ).toBe(false);
  });

  it('is another workflow when the declared params change', () => {
    expect(sameGoalSource({ ...source, declared: [] }, source)).toBe(false);
  });

  it('is no workflow before anything is typed', () => {
    expect(sameGoalSource(undefined, source)).toBe(false);
  });
});

describe('startNotice', () => {
  it('says why a start failed', () => {
    expect(
      startNotice({ kind: 'failed', message: 'The server said no.' }),
    ).toEqual({
      header: 'The run did not start.',
      message: 'The server said no.',
    });
  });

  it('warns that a second run may run the workflow twice', () => {
    const notice = startNotice({ kind: 'unsure', message: 'No answer came.' });

    expect(notice?.message).toBe(
      'No answer came. Reload the page to see whether it is going; starting another run may run the workflow twice.',
    );
  });

  it.each<RunStart>([{ kind: 'idle' }, { kind: 'starting' }, going])(
    'has nothing to say for $kind',
    (start) => {
      expect(startNotice(start)).toBeUndefined();
    },
  );
});

describe('goalText', () => {
  it('shows the default goal of the workflow before anything is typed', () => {
    expect(goalText(undefined, 'Add a greeting')).toBe('Add a greeting');
  });

  it('puts a default goal that wraps onto one line', () => {
    expect(goalText(undefined, 'Add a greeting\n  to the README')).toBe(
      'Add a greeting to the README',
    );
  });

  it('shows what the person typed', () => {
    expect(goalText('Fix the build', 'Add a greeting')).toBe('Fix the build');
  });

  it('keeps the box empty once the person clears it', () => {
    expect(goalText('', 'Add a greeting')).toBe('');
  });

  it('is empty for a workflow that declares no default goal', () => {
    expect(goalText(undefined, undefined)).toBe('');
  });
});

describe('startsOnEnter', () => {
  it('starts on Enter', () => {
    expect(startsOnEnter({ key: 'Enter' })).toBe(true);
  });

  it('does not start on another key', () => {
    expect(startsOnEnter({ key: 'a' })).toBe(false);
  });

  it('does not start on the Enter that ends typing in another script', () => {
    expect(startsOnEnter({ key: 'Enter', isComposing: true })).toBe(false);
  });

  it('does not start on the Enter that Safari reports as key code 229', () => {
    expect(startsOnEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
  });

  it.each([
    ['Alt', { altKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
  ])('does not start on Enter with %s', (_, modifier) => {
    expect(startsOnEnter({ key: 'Enter', ...modifier })).toBe(false);
  });
});
