// SPDX-License-Identifier: Apache-2.0
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { Execution } from './Execution';
import { TrustDialog } from './TrustDialog';
import { plainText } from '../workflow/message-parts';
import type { RunView } from '../api/types';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { HELLO_DOCUMENT, helloRun, loaded } from '../test-support/fixtures';
import {
  IDLE,
  MAX_READ_FAILURES,
  RunAlreadyActive,
  RunNeedsTrust,
  RunReadRefused,
  RunStartUnsure,
  type ExecutionState,
  type RunPort,
} from './core';

const RUN_ID = helloRun(0).runId;
const MAY_STILL_BE_RUNNING = `The run may still be going on the server (run ${RUN_ID}).`;

// A server that answers with the readings in turn and then repeats the last.
function serverShowing(...readings: RunView[]): RunPort {
  let next = 0;
  return {
    start: vi.fn().mockResolvedValue(RUN_ID),
    get: vi.fn(async () => readings[Math.min(next++, readings.length - 1)]!),
  };
}

async function openExecution(runs: RunPort) {
  const scheduler = new FakeScheduler();
  const { unmount } = render(
    <App
      load={Promise.resolve(loaded(HELLO_DOCUMENT, runs))}
      scheduler={scheduler}
    />,
  );
  await screen.findByTestId('node-end');
  fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));
  await screen.findByRole('button', { name: 'Run' });
  return Object.assign(scheduler, { unmount });
}

const runButton = () => screen.getByRole('button', { name: 'Run' });
const isOff = (button: HTMLElement) =>
  button.hasAttribute('disabled') ||
  button.getAttribute('aria-disabled') === 'true';
const statusLine = () => screen.getByTestId('run-status');
const badgeOf = (testId: string) =>
  within(screen.getByTestId(testId)).queryByTestId('status-badge')
    ?.textContent ?? null;
const badges = () => [
  badgeOf('node-intent'),
  badgeOf('node-stage-draft'),
  badgeOf('node-stage-review'),
  badgeOf('node-end'),
];

async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

async function tick(scheduler: FakeScheduler) {
  await act(async () => {
    scheduler.tick();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Execution tab before a run', () => {
  it('draws the same graph as the Designer, read-only, with a Run button', async () => {
    await openExecution(serverShowing(helloRun(0)));

    const graph = screen.getByRole('region', { name: 'Workflow graph' });
    for (const id of [
      'node-intent',
      'node-stage-draft',
      'node-stage-review',
      'node-end',
    ]) {
      expect(within(graph).getByTestId(id)).toBeTruthy();
    }
    expect(
      screen.getByRole('heading', { name: 'Workflow: hello' }),
    ).toBeTruthy();
    expect(isOff(runButton())).toBe(false);
  });

  it('shows no state on any node and says it is ready', async () => {
    await openExecution(serverShowing(helloRun(0)));

    expect(badges()).toEqual([null, null, null, null]);
    expect(statusLine().textContent).toContain('Ready. Press Run to start.');
  });

  it('offers the outcome of the intent as the goal', async () => {
    await openExecution(serverShowing(helloRun(0)));

    expect((screen.getByLabelText('Goal') as HTMLInputElement).value).toBe(
      'Add a greeting to the README',
    );
  });

  it('announces the status in a polite live region that is always there', async () => {
    await openExecution(serverShowing(helloRun(0)));

    const live = screen.getByTestId('run-live-status');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe('Ready. Press Run to start.');
  });

  it('keeps the visible status line out of the live regions, so nothing is said twice', async () => {
    await openExecution(serverShowing(helloRun(0)));

    expect(statusLine().closest('[role="status"], [role="alert"]')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('a run', () => {
  it('starts with the goal the person typed', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);

    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Fix the typo' },
    });
    await press(runButton());

    expect(runs.start).toHaveBeenCalledOnce();
    expect(runs.start).toHaveBeenCalledWith(
      'Fix the typo',
      expect.any(AbortSignal),
    );
  });

  it('shows each node going from queued to running to done, in order', async () => {
    const scheduler = await openExecution(
      serverShowing(helloRun(0), helloRun(1), helloRun(2)),
    );

    await press(runButton());
    expect(badges()).toEqual(['Done', 'Running', 'Queued', 'Queued']);
    expect(statusLine().textContent).toContain(
      'Running draft. 0 of 2 stages done.',
    );

    await tick(scheduler);
    expect(badges()).toEqual(['Done', 'Done', 'Running', 'Queued']);
    expect(statusLine().textContent).toContain(
      'Running review. 1 of 2 stages done.',
    );

    await tick(scheduler);
    expect(badges()).toEqual(['Done', 'Done', 'Done', 'Passed']);
    expect(statusLine().textContent).toContain(
      'Run passed. 2 of 2 stages done. Exit code 0.',
    );
  });

  it('puts the state in the name a screen reader reads for each node', async () => {
    await openExecution(serverShowing(helloRun(0)));

    await press(runButton());

    const graph = screen.getByRole('region', { name: 'Workflow graph' });
    expect(
      within(graph).getByRole('group', {
        name: 'Stage draft, agent k-developer, harness kiro-cli, running',
      }),
    ).toBeTruthy();
    expect(
      within(graph).getByRole('group', { name: 'End, queued' }),
    ).toBeTruthy();
  });

  it('reads the run once a second, with no read in between', async () => {
    const runs = serverShowing(helloRun(0), helloRun(1), helloRun(2));
    const scheduler = await openExecution(runs);

    await press(runButton());
    expect(runs.get).toHaveBeenCalledTimes(1);
    expect(scheduler.waits).toEqual([1000]);

    await tick(scheduler);
    await tick(scheduler);

    expect(runs.get).toHaveBeenCalledTimes(3);
    expect(scheduler.waits).toEqual([1000, 1000]);
    expect(runs.get).toHaveBeenCalledWith(RUN_ID, expect.any(AbortSignal));
  });

  it('cannot be started again while it is in flight, and can after it ends', async () => {
    const runs = serverShowing(helloRun(0), helloRun(2));
    const scheduler = await openExecution(runs);

    await press(runButton());
    expect(isOff(runButton())).toBe(true);
    expect(screen.getByLabelText('Goal').hasAttribute('readonly')).toBe(true);
    await press(runButton());
    expect(runs.start).toHaveBeenCalledOnce();

    await tick(scheduler);
    expect(isOff(runButton())).toBe(false);
    expect(screen.getByLabelText('Goal').hasAttribute('readonly')).toBe(false);
  });

  it('keeps keyboard focus in the goal box when Enter starts the run', async () => {
    await openExecution(serverShowing(helloRun(0)));
    const goal = screen.getByLabelText('Goal');
    goal.focus();

    await act(async () => {
      fireEvent.keyDown(goal, { key: 'Enter', keyCode: 13 });
    });

    expect(statusLine().textContent).toContain('Running draft.');
    expect(document.activeElement).toBe(goal);
    expect(goal.hasAttribute('disabled')).toBe(false);
  });

  it('disables Run from the moment of the click, before the run is accepted', async () => {
    let accept: (runId: string) => void = () => {};
    const runs: RunPort = {
      start: () => new Promise((resolve) => (accept = resolve)),
      get: async () => helloRun(0),
    };
    await openExecution(runs);

    await press(runButton());

    expect(isOff(runButton())).toBe(true);
    expect(statusLine().textContent).toContain('Starting the run.');
    await act(async () => accept(RUN_ID));
    expect(statusLine().textContent).toContain('Running draft.');
  });

  it('shows a failed stage, the stages that will not run and the halted result', async () => {
    const scheduler = await openExecution(
      serverShowing(helloRun(0), helloRun(0, { blockedAt: 0 })),
    );

    await press(runButton());
    await tick(scheduler);

    expect(badges()).toEqual(['Done', 'Failed', 'Not run', 'Halted']);
    expect(statusLine().textContent).toContain(
      'Run halted at draft. 0 of 2 stages done. Exit code 1.',
    );
    expect(isOff(runButton())).toBe(false);
  });

  it.each([
    ['RESULT_MISSING', 'The final message of the session has no result line.'],
    ['RESULT_INVALID', 'The result line of the session is not valid.'],
    ['RESULT_FAILURE', 'The agent reported that it could not do the work.'],
    [
      'SESSION_FAILED',
      'The session could not start, its agent was not found, or it ended with an error.',
    ],
    ['TIMEOUT', 'The stage, or one of its checks, ran out of time.'],
    [
      'OUTPUT_MISSING',
      'A file that the stage must leave behind does not exist.',
    ],
    [
      'OUTPUT_UNCHANGED',
      'A file that the stage must leave behind was not created or changed by the stage.',
    ],
    ['CHECK_FAILED', 'A check that the stage must pass failed.'],
  ])(
    'shows the blocked stage with the reason %s and what it means',
    async (reason, sentence) => {
      await openExecution(serverShowing(helloRun(0, { blockedAt: 1, reason })));

      await press(runButton());

      const blocked = await screen.findByTestId('blocked-stage');
      expect(blocked.textContent).toBe(
        `Blocked stagereviewReason${reason}${sentence}`,
      );
    },
  );

  it('shows a reason that the page does not know as it is, with no sentence', async () => {
    await openExecution(
      serverShowing(helloRun(0, { blockedAt: 0, reason: 'OUT_OF_CREDIT' })),
    );

    await press(runButton());

    const blocked = await screen.findByTestId('blocked-stage');
    expect(blocked.textContent).toBe('Blocked stagedraftReasonOUT_OF_CREDIT');
  });

  it('shows a blocked stage with no reason in the reply, with no reason block', async () => {
    const run = helloRun(0, { blockedAt: 1 });
    await openExecution(
      serverShowing({
        ...run,
        stages: run.stages.map(({ name, status }) => ({ name, status })),
      }),
    );

    await press(runButton());

    const blocked = await screen.findByTestId('blocked-stage');
    expect(blocked.textContent).toBe('Blocked stagereview');
    expect(statusLine().textContent).toContain('review');
    expect(screen.queryByTestId('run-error')).toBeNull();
  });

  it('shows no blocked stage while the run goes on, or after it passed', async () => {
    const scheduler = await openExecution(
      serverShowing(helloRun(0), helloRun(2)),
    );

    await press(runButton());
    expect(screen.queryByTestId('blocked-stage')).toBeNull();
    await tick(scheduler);

    expect(statusLine().textContent).toContain('Run passed.');
    expect(screen.queryByTestId('blocked-stage')).toBeNull();
  });

  it('shows no error alert when a stage fails: the failure is a result, not an error', async () => {
    await openExecution(serverShowing(helloRun(0, { blockedAt: 1 })));

    await press(runButton());

    expect(screen.queryByTestId('run-error')).toBeNull();
  });

  it('can be run again, starting from the first stage', async () => {
    const runs = serverShowing(helloRun(2));
    await openExecution(runs);
    await press(runButton());
    expect(badges()).toEqual(['Done', 'Done', 'Done', 'Passed']);

    runs.get = vi.fn().mockResolvedValue(helloRun(0));
    await press(runButton());

    expect(runs.start).toHaveBeenCalledTimes(2);
    expect(badges()).toEqual(['Done', 'Running', 'Queued', 'Queued']);
  });

  it('goes on while the Designer tab is open, and shows the result when back', async () => {
    const scheduler = await openExecution(
      serverShowing(helloRun(0), helloRun(2)),
    );
    await press(runButton());

    fireEvent.click(screen.getByRole('tab', { name: 'Designer' }));
    await tick(scheduler);
    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    expect(badges()).toEqual(['Done', 'Done', 'Done', 'Passed']);
    expect(statusLine().textContent).toContain('Run passed.');
  });

  it('shows no state on the Designer tab', async () => {
    await openExecution(serverShowing(helloRun(0)));
    await press(runButton());

    fireEvent.click(screen.getByRole('tab', { name: 'Designer' }));

    expect(screen.queryAllByTestId('status-badge')).toEqual([]);
  });

  it('stops reading when the page is closed', async () => {
    const runs = serverShowing(helloRun(0), helloRun(1), helloRun(2));
    const scheduler = await openExecution(runs);
    await press(runButton());

    scheduler.unmount();
    await tick(scheduler);

    expect(runs.get).toHaveBeenCalledTimes(1);
  });
});

describe('a run that is already active', () => {
  function serverBusyWith(...readings: RunView[]): RunPort {
    const runs = serverShowing(...readings);
    runs.start = vi
      .fn()
      .mockRejectedValue(
        new RunAlreadyActive('A run is already active.', RUN_ID),
      );
    return runs;
  }

  it('is followed, with no alert, and says so', async () => {
    const runs = serverBusyWith(helloRun(1), helloRun(2));
    const scheduler = await openExecution(runs);

    await press(runButton());

    expect(runs.get).toHaveBeenCalledWith(RUN_ID, expect.any(AbortSignal));
    expect(screen.queryByTestId('run-error')).toBeNull();
    expect(statusLine().textContent).toBe(
      'Following the run that was already in progress. Running review. 1 of 2 stages done.',
    );
    expect(badges()).toEqual(['Done', 'Done', 'Running', 'Queued']);
    expect(isOff(runButton())).toBe(true);

    await tick(scheduler);

    expect(badges()).toEqual(['Done', 'Done', 'Done', 'Passed']);
    expect(isOff(runButton())).toBe(false);
  });

  it('keeps saying it was already going once it has ended', async () => {
    const runs = serverBusyWith(helloRun(1), helloRun(2));
    const scheduler = await openExecution(runs);
    await press(runButton());

    await tick(scheduler);

    expect(statusLine().textContent).toBe(
      'The run that was already in progress passed. 2 of 2 stages done. Exit code 0.',
    );
  });

  it('does not show a goal of its own, which the API does not give', async () => {
    const runs = serverBusyWith(helloRun(1), helloRun(2));
    const scheduler = await openExecution(runs);
    const goalBox = () => screen.getByLabelText('Goal') as HTMLInputElement;
    fireEvent.change(goalBox(), { target: { value: 'Fix the typo' } });

    await press(runButton());

    expect(goalBox().value).toBe('');
    expect(goalBox().placeholder).toBe('Not known');
    expect(goalBox().readOnly).toBe(true);
    expect(
      screen.getByText(
        'This run was already going, so its goal is not known here.',
      ),
    ).toBeTruthy();

    await tick(scheduler);

    expect(goalBox().value).toBe('Fix the typo');
    expect(goalBox().readOnly).toBe(false);
  });
});

describe('the canvas of the Execution tab', () => {
  it('stays the same canvas while the page draws again, as when the goal is typed', async () => {
    await openExecution(serverShowing(helloRun(0)));
    const canvas = () =>
      within(screen.getByRole('tabpanel', { name: 'Execution' })).getByRole(
        'region',
        { name: 'Workflow graph' },
      );
    const before = canvas();

    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'Another goal' },
    });

    expect(canvas()).toBe(before);
  });
});

describe('the goal', () => {
  const goalBox = () => screen.getByLabelText('Goal') as HTMLInputElement;
  const openTab = (name: string) =>
    fireEvent.click(screen.getByRole('tab', { name }));

  it('is kept when the person goes to the Designer tab and comes back', async () => {
    await openExecution(serverShowing(helloRun(0)));
    fireEvent.change(goalBox(), { target: { value: 'Fix the typo' } });

    openTab('Designer');
    openTab('Execution');

    expect(goalBox().value).toBe('Fix the typo');
    expect(isOff(runButton())).toBe(false);
  });

  it('shows the goal of the run in flight, read-only, when the person comes back', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);
    fireEvent.change(goalBox(), { target: { value: 'Fix the typo' } });
    await press(runButton());

    openTab('Designer');
    openTab('Execution');

    expect(goalBox().value).toBe('Fix the typo');
    expect(goalBox().readOnly).toBe(true);
    expect(isOff(runButton())).toBe(true);
    expect(runs.start).toHaveBeenCalledWith(
      'Fix the typo',
      expect.any(AbortSignal),
    );
  });

  it('does not start a run when Enter ends the composition of a character', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);

    await act(async () => {
      fireEvent.keyDown(goalBox(), {
        key: 'Enter',
        keyCode: 13,
        isComposing: true,
      });
    });

    expect(runs.start).not.toHaveBeenCalled();
  });

  it('does not start a run when Enter ends a composition that Safari reports late', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);

    await act(async () => {
      fireEvent.keyDown(goalBox(), {
        key: 'Enter',
        keyCode: 229,
        isComposing: false,
      });
    });

    expect(runs.start).not.toHaveBeenCalled();
  });

  it('offers a goal of one line when the outcome of the intent has line breaks', async () => {
    const many = {
      ...HELLO_DOCUMENT,
      view: {
        ...HELLO_DOCUMENT.view!,
        intent: { outcome: 'Fix the typo\n  and add a test\r\nthen ship' },
      },
    };
    const runs = serverShowing(helloRun(0));
    render(
      <App
        load={Promise.resolve(loaded(many, runs))}
        scheduler={new FakeScheduler()}
      />,
    );
    await screen.findByTestId('node-end');
    openTab('Execution');
    await screen.findByRole('button', { name: 'Run' });

    expect(goalBox().value).toBe('Fix the typo and add a test then ship');
    await press(runButton());

    expect(runs.start).toHaveBeenCalledWith(
      'Fix the typo and add a test then ship',
      expect.any(AbortSignal),
    );
  });

  it('starts a run when Enter is pressed in the goal box', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);

    await act(async () => {
      fireEvent.keyDown(goalBox(), { key: 'Enter', keyCode: 13 });
    });

    expect(runs.start).toHaveBeenCalledOnce();
  });

  it('does not start a run on Enter when the goal is empty', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);
    fireEvent.change(goalBox(), { target: { value: '' } });

    await act(async () => {
      fireEvent.keyDown(goalBox(), { key: 'Enter', keyCode: 13 });
    });

    expect(runs.start).not.toHaveBeenCalled();
  });

  it('does not start a run on Enter while a run is in flight', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);
    await press(runButton());

    await act(async () => {
      fireEvent.keyDown(goalBox(), { key: 'Enter', keyCode: 13 });
    });

    expect(runs.start).toHaveBeenCalledOnce();
  });

  it('turns Run off, and says why, when the goal is empty', async () => {
    const runs = serverShowing(helloRun(0));
    await openExecution(runs);

    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: '  ' },
    });

    expect(isOff(runButton())).toBe(true);
    expect(screen.getAllByText('Enter a goal to run.').length).toBeGreaterThan(
      0,
    );
    await press(runButton());
    expect(runs.start).not.toHaveBeenCalled();
  });

  it('turns Run off when the goal is too long', async () => {
    await openExecution(serverShowing(helloRun(0)));

    fireEvent.change(screen.getByLabelText('Goal'), {
      target: { value: 'x'.repeat(2049) },
    });

    expect(isOff(runButton())).toBe(true);
    expect(
      screen.getAllByText('The goal can have at most 2048 characters.').length,
    ).toBeGreaterThan(0);
  });
});

describe('a run refused because the workflow is not trusted', () => {
  const FIX = 'Run `konductor flow trust hello` in a terminal, then try again.';
  const COMMAND = 'konductor flow trust hello';
  const untrusted = () =>
    new RunNeedsTrust(`The workflow is not trusted yet. ${FIX}`, FIX);

  const modal = () => createWrapper(document.body).findModal();
  const dialog = () => screen.getByTestId('trust-dialog');
  const goalBox = () => screen.getByRole('textbox') as HTMLInputElement;

  function refusing(...answers: Array<Error | string>): RunPort {
    const start = vi.fn();
    for (const answer of answers) {
      if (typeof answer === 'string') start.mockResolvedValueOnce(answer);
      else start.mockRejectedValueOnce(answer);
    }
    return { start, get: vi.fn().mockResolvedValue(helloRun(2)) };
  }

  it('opens a dialog with the fix of the server and its command', async () => {
    await openExecution(refusing(untrusted()));

    await press(runButton());

    expect(modal()?.isVisible()).toBe(true);
    expect(
      within(dialog()).getByText('Trust the workflow to run it'),
    ).toBeTruthy();
    expect(screen.getByTestId('trust-fix').textContent).toBe(
      'Run konductor flow trust hello in a terminal, then try again.',
    );
    expect(
      screen.getByTestId('trust-fix').querySelector('code')?.textContent,
    ).toBe(COMMAND);
    expect(screen.getByTestId('trust-command').textContent).toBe(COMMAND);
    expect(screen.getByTestId('trust-intro').textContent).toBe(
      'The workflow is not trusted, so it did not run. Run the command in a terminal and answer its question, then press Run again. This page cannot trust a workflow.',
    );
  });

  it('copies the command with Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    try {
      await openExecution(refusing(untrusted()));
      await press(runButton());

      await press(
        within(dialog()).getByRole('button', { name: 'Copy command' }),
      );

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(COMMAND));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts the run again with the same goal with Run again', async () => {
    const runs = refusing(untrusted(), RUN_ID);
    await openExecution(runs);
    fireEvent.change(goalBox(), { target: { value: 'Ship it' } });
    await press(runButton());

    await press(within(dialog()).getByRole('button', { name: 'Run again' }));

    expect(runs.start).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runs.start).mock.calls.map(([goal]) => goal)).toEqual([
      'Ship it',
      'Ship it',
    ]);
    expect(modal()?.isVisible() ?? false).toBe(false);
    await waitFor(() =>
      expect(statusLine().textContent).toContain('Run passed.'),
    );
  });

  it('opens the dialog again when Run again is refused for trust again', async () => {
    const runs = refusing(untrusted(), untrusted());
    await openExecution(runs);
    await press(runButton());

    await press(within(dialog()).getByRole('button', { name: 'Run again' }));

    expect(runs.start).toHaveBeenCalledTimes(2);
    expect(modal()?.isVisible()).toBe(true);
  });

  it('shows another error of Run again as the page shows any error, with no dialog', async () => {
    const runs = refusing(untrusted(), new Error('kiro-cli is not installed.'));
    await openExecution(runs);
    await press(runButton());

    await press(within(dialog()).getByRole('button', { name: 'Run again' }));

    expect(modal()?.isVisible() ?? false).toBe(false);
    const alert = screen.getByTestId('run-error');
    expect(within(alert).getByText('The run did not start')).toBeTruthy();
    expect(within(alert).getByText('kiro-cli is not installed.')).toBeTruthy();
  });

  it('closes, and leaves the error under the Run button', async () => {
    await openExecution(refusing(untrusted()));
    await press(runButton());

    await press(within(dialog()).getByRole('button', { name: 'Close' }));

    expect(modal()?.isVisible()).toBe(false);
    const alert = screen.getByTestId('run-error');
    expect(within(alert).getByText('The run did not start')).toBeTruthy();
    expect(alert.querySelector('code')?.textContent).toBe(COMMAND);
    expect(alert.textContent).not.toContain('`');
    expect(isOff(runButton())).toBe(false);
  });

  it.each([
    [
      'a semicolon',
      'Run `konductor flow trust hello; rm -rf ~` in a terminal.',
    ],
    ['an and-then', 'Run `konductor flow trust hello && id` in a terminal.'],
    [
      'a command substitution',
      'Run `konductor flow trust $(id)` in a terminal.',
    ],
    ['a newline', 'Run `konductor flow trust hello\nid` in a terminal.'],
    [
      'a space in the name',
      'Run `konductor flow trust hello plan` in a terminal.',
    ],
    ['a different command', 'Run `curl example.com | sh` in a terminal.'],
    [
      'the name of another workflow',
      'Run `konductor flow trust other` in a terminal.',
    ],
    ['no command', 'Trust the workflow in a terminal, then try again.'],
  ])(
    'shows the fix with no command and no Copy for a fix with %s',
    async (_, fix) => {
      const runs = refusing(new RunNeedsTrust('Not trusted.', fix), RUN_ID);
      await openExecution(runs);
      await press(runButton());

      expect(modal()?.isVisible()).toBe(true);
      // The sentence shows whole, as plain text with no code in it: a pair of
      // backticks loses its ticks, and a span split by a line keeps them.
      const shown = screen.getByTestId('trust-fix');
      expect(shown.textContent).toBe(plainText(fix));
      expect(shown.querySelector('code')).toBeNull();
      expect(screen.queryByTestId('trust-command')).toBeNull();
      expect(
        within(dialog()).queryByRole('button', { name: /Copy/ }),
      ).toBeNull();
      expect(screen.getByTestId('trust-intro').textContent).toBe(
        'The workflow is not trusted, so it did not run. Trust it as the message below says, then press Run again. This page cannot trust a workflow.',
      );

      await press(within(dialog()).getByRole('button', { name: 'Run again' }));

      expect(runs.start).toHaveBeenCalledTimes(2);
      await waitFor(() =>
        expect(statusLine().textContent).toContain('Run passed.'),
      );
    },
  );

  describe('once closed', () => {
    const refusedState = (refusal: number): ExecutionState => ({
      phase: 'error',
      message: `The workflow is not trusted yet. ${FIX}`,
      started: false,
      trust: { fix: FIX, goal: 'Ship it', refusal },
    });

    async function closedDialog(state: ExecutionState) {
      const onRunAgain = vi.fn();
      const view = render(
        <TrustDialog
          state={state}
          workflowName="hello"
          onRunAgain={onRunAgain}
        />,
      );
      expect(modal()?.isVisible()).toBe(true);
      await press(within(dialog()).getByRole('button', { name: 'Close' }));
      expect(modal()?.isVisible()).toBe(false);
      return { ...view, onRunAgain };
    }

    it('stays closed when the page draws it again', async () => {
      const state = refusedState(1);
      const { rerender, onRunAgain } = await closedDialog(state);

      rerender(
        <TrustDialog
          state={state}
          workflowName="hello"
          onRunAgain={onRunAgain}
        />,
      );
      rerender(
        <TrustDialog state={state} workflowName="hello" onRunAgain={vi.fn()} />,
      );

      expect(modal()?.isVisible()).toBe(false);
    });

    it('stays closed for a state rebuilt with the same content', async () => {
      const { rerender, onRunAgain } = await closedDialog(refusedState(1));

      rerender(
        <TrustDialog
          state={structuredClone(refusedState(1))}
          workflowName="hello"
          onRunAgain={onRunAgain}
        />,
      );

      expect(modal()?.isVisible()).toBe(false);
    });

    it('opens again for the next refusal', async () => {
      const { rerender, onRunAgain } = await closedDialog(refusedState(1));

      rerender(
        <TrustDialog
          state={refusedState(2)}
          workflowName="hello"
          onRunAgain={onRunAgain}
        />,
      );

      expect(modal()?.isVisible()).toBe(true);
    });

    it('opens again when Run is refused again after Close', async () => {
      const runs = refusing(untrusted(), untrusted());
      await openExecution(runs);
      await press(runButton());
      await press(within(dialog()).getByRole('button', { name: 'Close' }));
      expect(modal()?.isVisible()).toBe(false);

      await press(runButton());

      expect(runs.start).toHaveBeenCalledTimes(2);
      expect(modal()?.isVisible()).toBe(true);
    });
  });

  it('offers nothing that grants trust', async () => {
    await openExecution(refusing(untrusted()));
    await press(runButton());

    const labels = within(dialog())
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Copy', 'Close', 'Run again']),
    );
    expect(labels.some((label) => /trust/i.test(label ?? ''))).toBe(false);
  });
});

describe('errors from the API', () => {
  it('shows one alert with the sentence of the server when the run does not start', async () => {
    const runs: RunPort = {
      start: vi.fn().mockRejectedValue(new Error('A run is already active.')),
      get: vi.fn(),
    };
    await openExecution(runs);

    await press(runButton());

    const alert = screen.getByTestId('run-error');
    expect(within(alert).getByText('The run did not start')).toBeTruthy();
    expect(within(alert).getByText('A run is already active.')).toBeTruthy();
    expect(screen.getAllByTestId('run-error')).toHaveLength(1);
    expect(within(alert).queryByText(MAY_STILL_BE_RUNNING)).toBeNull();
    expect(statusLine().textContent).toContain('See the error below.');
    expect(badges()).toEqual([null, null, null, null]);
    expect(isOff(runButton())).toBe(false);
  });

  it('says the run may have started when the server did not answer the start', async () => {
    const runs: RunPort = {
      start: vi
        .fn()
        .mockRejectedValue(new RunStartUnsure('The server did not answer.')),
      get: vi.fn(),
    };
    await openExecution(runs);

    await press(runButton());

    const alert = screen.getByTestId('run-error');
    expect(
      within(alert).getByText('The run may not have started'),
    ).toBeTruthy();
    expect(within(alert).getByText('The server did not answer.')).toBeTruthy();
    expect(
      within(alert).getByText(
        'The run may be going on the server. Press Run to join it.',
      ),
    ).toBeTruthy();
    expect(isOff(runButton())).toBe(false);
  });

  it('shows one alert, and clears the states, when a reading fails', async () => {
    const runs: RunPort = {
      start: vi.fn().mockResolvedValue(RUN_ID),
      get: vi
        .fn()
        .mockResolvedValueOnce(helloRun(0))
        .mockRejectedValue(new Error('The server did not answer.')),
    };
    const scheduler = await openExecution(runs);
    await press(runButton());

    for (let attempt = 0; attempt < MAX_READ_FAILURES; attempt += 1) {
      expect(screen.queryByTestId('run-error')).toBeNull();
      await tick(scheduler);
    }

    const alert = screen.getByTestId('run-error');
    expect(
      within(alert).getByText('The run could not be followed'),
    ).toBeTruthy();
    expect(within(alert).getByText('The server did not answer.')).toBeTruthy();
    expect(within(alert).getByText(MAY_STILL_BE_RUNNING)).toBeTruthy();
    expect(screen.getAllByTestId('run-error')).toHaveLength(1);
    expect(statusLine().textContent).toContain('See the error below.');
    expect(badges()).toEqual([null, null, null, null]);
    expect(isOff(runButton())).toBe(false);
  });

  it('keeps following the run when one reading fails and the next works', async () => {
    const runs: RunPort = {
      start: vi.fn().mockResolvedValue(RUN_ID),
      get: vi
        .fn()
        .mockResolvedValueOnce(helloRun(0))
        .mockRejectedValueOnce(new Error('The server did not answer.'))
        .mockResolvedValue(helloRun(1)),
    };
    const scheduler = await openExecution(runs);
    await press(runButton());

    await tick(scheduler);
    expect(screen.queryByTestId('run-error')).toBeNull();
    expect(isOff(runButton())).toBe(true);
    await tick(scheduler);

    expect(badges()).toEqual(['Done', 'Done', 'Running', 'Queued']);
    expect(screen.queryByTestId('run-error')).toBeNull();
  });

  it('puts the alert under the Run button', async () => {
    const runs: RunPort = {
      start: vi.fn().mockRejectedValue(new Error('A run is already active.')),
      get: vi.fn(),
    };
    await openExecution(runs);

    await press(runButton());

    expect(
      runButton().compareDocumentPosition(screen.getByTestId('run-error')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('names the run in the alert when the following failed', async () => {
    const runs: RunPort = {
      start: vi.fn().mockResolvedValue(RUN_ID),
      get: vi
        .fn()
        .mockResolvedValueOnce(helloRun(0))
        .mockRejectedValue(new RunReadRefused('There is no run with this id.')),
    };
    const scheduler = await openExecution(runs);
    await press(runButton());

    await tick(scheduler);

    expect(
      within(screen.getByTestId('run-error')).getByText(
        `The run may still be going on the server (run ${RUN_ID}).`,
      ),
    ).toBeTruthy();
  });

  it('says the run may not have started when the start got no clear answer', async () => {
    const runs: RunPort = {
      start: vi.fn().mockRejectedValue(new RunStartUnsure('No answer.')),
      get: vi.fn(),
    };
    await openExecution(runs);

    await press(runButton());

    const error = screen.getByTestId('run-error');
    expect(error.textContent).toContain('The run may not have started');
    expect(error.textContent).toContain('Press Run to join it.');
    expect(screen.getByTestId('run-live-alert').textContent).toBe(
      'The run may not have started. No answer. The run may be going on the server. Press Run to join it.',
    );
  });
});

describe('the live regions', () => {
  const alertLive = () => screen.getByTestId('run-live-alert');
  const statusLive = () => screen.getByTestId('run-live-status');

  it('are on the page before any run, and the alert one is empty', async () => {
    await openExecution(serverShowing(helloRun(0)));

    expect(alertLive().getAttribute('role')).toBe('alert');
    expect(alertLive().textContent).toBe('');
    expect(statusLive().getAttribute('role')).toBe('status');
  });

  it('say why a run did not start', async () => {
    const runs: RunPort = {
      start: vi.fn().mockRejectedValue(new Error('A run is already active.')),
      get: vi.fn(),
    };
    await openExecution(runs);

    await press(runButton());

    expect(alertLive().textContent).toBe(
      'The run did not start. A run is already active.',
    );
    expect(statusLive().textContent).toBe('');
  });

  it('say a name in backticks as plain text, while the alert shows it as code', async () => {
    const runs: RunPort = {
      start: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'The server no longer knows this session. Start `flow view` again and open the address it prints.',
          ),
        ),
      get: vi.fn(),
    };
    await openExecution(runs);

    await press(runButton());

    expect(alertLive().textContent).toBe(
      'The run did not start. The server no longer knows this session. Start flow view again and open the address it prints.',
    );
    expect(alertLive().textContent).not.toContain('`');
    expect(
      screen.getByTestId('run-error').querySelector('code')?.textContent,
    ).toBe('flow view');
  });

  it('say that the run ended, while the Designer tab is open', async () => {
    const runs = serverShowing(helloRun(0), helloRun(1), helloRun(2));
    const scheduler = await openExecution(runs);
    await press(runButton());

    fireEvent.click(screen.getByRole('tab', { name: 'Designer' }));
    expect(screen.queryByTestId('run-status')).toBeNull();
    await tick(scheduler);
    await tick(scheduler);

    expect(statusLive().textContent).toBe(
      'Run passed. 2 of 2 stages done. Exit code 0.',
    );
  });

  it('say why the stage of a halted run stopped, in the sentence of its reason', async () => {
    await openExecution(serverShowing(helloRun(0, { blockedAt: 1 })));

    await press(runButton());

    await waitFor(() =>
      expect(statusLive().textContent).toBe(
        'Run halted at review. 1 of 2 stages done. Exit code 1. The final message of the session has no result line.',
      ),
    );
    expect(statusLive().textContent).not.toContain('`');
  });

  it('say the code of a reason that the page does not know', async () => {
    await openExecution(
      serverShowing(helloRun(0, { blockedAt: 0, reason: 'OUT_OF_CREDIT' })),
    );

    await press(runButton());

    await waitFor(() =>
      expect(statusLive().textContent).toBe(
        'Run halted at draft. 0 of 2 stages done. Exit code 1. OUT_OF_CREDIT',
      ),
    );
  });

  it.each([
    ['no reason', undefined],
    ['an empty reason', ''],
  ])('say no reason for a blocked stage with %s', async (_, reason) => {
    const run = helloRun(0, { blockedAt: 1 });
    await openExecution(
      serverShowing({
        ...run,
        stages: run.stages.map(({ name, status }) =>
          reason === undefined ? { name, status } : { name, status, reason },
        ),
      }),
    );

    await press(runButton());

    await waitFor(() =>
      expect(statusLive().textContent).toBe(
        'Run halted at review. 1 of 2 stages done. Exit code 1.',
      ),
    );
  });

  it('say that the run could not be followed, while the Designer tab is open', async () => {
    const runs: RunPort = {
      start: vi.fn().mockResolvedValue(RUN_ID),
      get: vi
        .fn()
        .mockResolvedValueOnce(helloRun(0))
        .mockRejectedValue(new RunReadRefused('There is no run with this id.')),
    };
    const scheduler = await openExecution(runs);
    await press(runButton());

    fireEvent.click(screen.getByRole('tab', { name: 'Designer' }));
    expect(screen.queryByTestId('run-error')).toBeNull();
    await tick(scheduler);

    expect(alertLive().textContent).toBe(
      `The run could not be followed. There is no run with this id. The run may still be going on the server (run ${RUN_ID}).`,
    );
    expect(statusLive().textContent).toBe('');
  });
});

describe('the alert, when another run is started', () => {
  it('takes the alert away when a new run starts', async () => {
    const runs: RunPort = {
      start: vi
        .fn()
        .mockRejectedValueOnce(new Error('A run is already active.'))
        .mockResolvedValue(RUN_ID),
      get: vi.fn().mockResolvedValue(helloRun(0)),
    };
    await openExecution(runs);
    await press(runButton());
    expect(screen.getByTestId('run-error')).toBeTruthy();

    await press(runButton());

    await waitFor(() => expect(screen.queryByTestId('run-error')).toBeNull());
    expect(badges()).toEqual(['Done', 'Running', 'Queued', 'Queued']);
  });
});

describe('a run whose stages are not the stages of the graph', () => {
  const OTHER_STAGES: RunView = {
    ...helloRun(0),
    stages: [
      { name: 'write', status: 'running' },
      { name: 'review', status: 'pending' },
    ],
  };
  const notice = () => screen.queryByTestId('stage-drift');

  it('says so, naming the stages that differ, once the run is read', async () => {
    const scheduler = await openExecution(serverShowing(OTHER_STAGES));
    expect(notice()).toBeNull();

    await press(runButton());
    await tick(scheduler);

    expect(notice()?.textContent).toContain('not the stages in the graph');
    expect(notice()?.textContent).toContain('Not drawn: write.');
    expect(notice()?.textContent).toContain('Not in the run: draft.');
  });

  it('says the file changed after the page loaded or after the run started, and tells the person to reload the page', async () => {
    const scheduler = await openExecution(serverShowing(OTHER_STAGES));

    await press(runButton());
    await tick(scheduler);

    expect(notice()?.textContent).toContain('after this page loaded');
    expect(notice()?.textContent).toContain('after the run started');
    expect(notice()?.textContent).toContain('Reload the page to draw it.');
    expect(notice()?.textContent).not.toMatch(/launch address/i);
  });

  it('says nothing for a run of the stages that are drawn', async () => {
    const scheduler = await openExecution(serverShowing(helloRun(0)));

    await press(runButton());
    await tick(scheduler);

    expect(statusLine().textContent).toContain('Running draft');
    expect(notice()).toBeNull();
  });
});

describe('when there is no workflow to run', () => {
  it('shows the message of the failed load, with no Run button', async () => {
    render(
      <App
        load={Promise.resolve({ ok: false, message: 'The code is not valid.' })}
        scheduler={new FakeScheduler()}
      />,
    );
    await screen.findByText('The code is not valid.');

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    expect(
      screen.getAllByText('The code is not valid.').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('says it is loading while the load is under way', () => {
    render(
      <App load={new Promise(() => {})} scheduler={new FakeScheduler()} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));

    expect(screen.getAllByText('Loading the workflow').length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });
});

describe('when the workflow is replaced', () => {
  it('draws a new canvas, so it is fitted to the new workflow', () => {
    const controller = { state: IDLE, start: vi.fn() };
    const draw = () => (
      <Execution
        result={loaded(HELLO_DOCUMENT, serverShowing(helloRun(0)))}
        execution={controller}
        goal="g"
        onGoalChange={vi.fn()}
      />
    );
    const { rerender } = render(draw());
    const before = screen.getByRole('region', { name: 'Workflow graph' });

    rerender(draw());

    expect(screen.getByRole('region', { name: 'Workflow graph' })).not.toBe(
      before,
    );
  });
});

describe('when another workflow is opened during a run', () => {
  async function openSecondWorkflowMidRun() {
    const scheduler = new FakeScheduler();
    const first = serverShowing(helloRun(0));
    const second = serverShowing(helloRun(0));
    const view = (runs: RunPort) => (
      <App
        load={Promise.resolve(loaded(HELLO_DOCUMENT, runs))}
        scheduler={scheduler}
      />
    );
    const { rerender } = render(view(first));
    await screen.findByTestId('node-end');
    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));
    await press(await screen.findByRole('button', { name: 'Run' }));
    await tick(scheduler);
    expect(statusLine().textContent).toContain('Running draft');

    rerender(view(second));
    await waitFor(() =>
      expect(statusLine().textContent).toContain('Ready. Press Run to start.'),
    );
    return { scheduler, first, second };
  }

  it('lets go of the run and clears its status', async () => {
    await openSecondWorkflowMidRun();

    expect(badges()).toEqual([null, null, null, null]);
    expect(isOff(runButton())).toBe(false);
  });

  it('stops reading the run of the workflow that was left', async () => {
    const { scheduler, first } = await openSecondWorkflowMidRun();
    const reads = vi.mocked(first.get).mock.calls.length;

    await tick(scheduler);

    expect(vi.mocked(first.get).mock.calls).toHaveLength(reads);
  });

  it('starts the next run on the workflow that is open', async () => {
    const { first, second } = await openSecondWorkflowMidRun();

    await press(runButton());

    expect(second.start).toHaveBeenCalledOnce();
    expect(vi.mocked(first.start)).toHaveBeenCalledTimes(1);
  });
});
