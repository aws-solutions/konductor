// SPDX-License-Identifier: Apache-2.0
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
import type { RunView } from '../api/types';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { HELLO_DOCUMENT, helloRun, loaded } from '../test-support/fixtures';
import {
  IDLE,
  MAX_READ_FAILURES,
  RunReadRefused,
  RunStartUnsure,
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
