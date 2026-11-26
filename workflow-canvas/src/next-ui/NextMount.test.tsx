// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { WorkflowExtras } from '../api/workflow-extras';
import type { AgentOption } from '../designer-view/field-rules';
import type { CheckAnswer, ValidateRequest } from '../designer-view/yaml-draft';
import type { RunMemory, RunPort } from '../execution/core/ports';
import type { SwapRisk } from '../launch/swap-guard';
import { EventWaits, HeldEvents } from '../test-support/held-events';
import { acceptingEdits } from '../test-support/fake-edits';
import { HELLO_DOCUMENT, loaded } from '../test-support/fixtures';
import { FAKE_EXTRAS, fakeNextPorts } from '../test-support/next-ports';
import type { NextPorts } from './next-http';

const RUN_ID = '20261024-0412-a7b3c';

async function openPage({
  ports = fakeNextPorts(),
  swapRisk,
  runMemory,
}: {
  ports?: NextPorts;
  swapRisk?: SwapRisk;
  runMemory?: RunMemory;
} = {}) {
  // The waits of a long poll and of the run clock are held, so a follower
  // reads only what a test answers.
  const scheduler = new EventWaits();
  const runs: RunPort = { start: vi.fn(() => Promise.resolve(RUN_ID)) };
  const edits = acceptingEdits();
  const result = loaded(HELLO_DOCUMENT, runs, edits);
  const portsFor = vi.fn(() => ports);
  render(
    <App
      load={Promise.resolve(result)}
      scheduler={scheduler}
      nextPortsFor={portsFor}
      {...(swapRisk ? { swapRisk } : {})}
      {...(runMemory ? { runMemory } : {})}
    />,
  );
  await act(async () => {});
  return { ports, scheduler, runs, result, portsFor, edits };
}

const runTab = () => screen.getByRole('tab', { name: 'Run' });

describe('the page views', () => {
  it('builds the calls of the views for the workflow it shows', async () => {
    const { portsFor, result } = await openPage();

    // The token of those calls comes from this workflow, not from whichever
    // load answered last.
    expect(portsFor).toHaveBeenCalledTimes(1);
    expect(portsFor).toHaveBeenCalledWith(
      result.ok ? result.workflow : undefined,
    );
  });

  it('draws the Design view, with the mark where the run ends', async () => {
    await openPage();

    expect(
      screen.getByRole('img', { name: 'The run ends after review' }),
    ).toBeTruthy();
    expect(screen.getByTestId('yaml-text')).toBeTruthy();
  });

  it('reads the fields and the agents of the workflow', async () => {
    const { ports } = await openPage();

    expect(ports.loadExtras).toHaveBeenCalled();
    expect(ports.listAgents).toHaveBeenCalled();
  });

  it('draws the Run view, with the default goal of the workflow', async () => {
    await openPage();

    await act(async () => {
      fireEvent.click(runTab());
    });

    const goal = screen.getByRole('textbox') as HTMLInputElement;
    expect(goal.value).toBe('Add a greeting to the README');
    expect(screen.getByText('No run yet.')).toBeTruthy();
  });

  it('lists the past runs of the workflow', async () => {
    const { ports } = await openPage();

    await act(async () => {
      fireEvent.click(runTab());
    });

    expect(ports.listRuns).toHaveBeenCalled();
  });

  it('says so when the fields of the workflow cannot be read', async () => {
    await openPage({
      ports: fakeNextPorts({
        loadExtras: vi.fn(() =>
          Promise.reject(new Error('The server said no.')),
        ),
      }),
    });

    expect(screen.getByTestId('next-data-error').textContent).toContain(
      'The server said no.',
    );
  });
});

describe('the run lifecycle of the page', () => {
  const runningDraft = {
    events: [
      { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
    ],
    next: 1,
    finished: false,
  };

  // One answer, then the follower waits, as it does against a server with
  // nothing new to send.
  async function startRun(events: HeldEvents) {
    await act(async () => {
      fireEvent.click(runTab());
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    });
    if (events.waiting) {
      await act(async () => {
        events.answer(runningDraft);
      });
    }
  }

  it('follows a run through the new view only', async () => {
    const events = new HeldEvents();
    const ports = fakeNextPorts({ readEvents: events.readEvents });
    const { runs } = await openPage({ ports });

    await startRun(events);

    expect(ports.startRun).toHaveBeenCalledTimes(1);
    expect(runs.start).not.toHaveBeenCalled();
    expect(events.calls.length).toBeGreaterThan(0);
  });

  it('goes on following the run while the Design view is shown', async () => {
    const events = new HeldEvents();
    await openPage({
      ports: fakeNextPorts({ readEvents: events.readEvents }),
    });
    await startRun(events);
    const read = events.calls.length;

    // The page follows the run, so looking at the Design view takes nothing
    // off: the read of the next events is still out.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    });
    await act(async () => {
      events.answer({
        events: [
          { seq: 2, type: 'stage_state', stage: 'draft', status: 'passed' },
          { seq: 3, type: 'stage_state', stage: 'review', status: 'running' },
        ],
        next: 3,
        finished: false,
      });
    });

    expect(events.calls.length).toBeGreaterThan(read);
    expect(events.waiting).toBe(true);
    // Coming back shows what came while it was away.
    await act(async () => {
      fireEvent.click(runTab());
    });
    expect(screen.getByTestId('run-progress').textContent).toContain('review');
  });

  it('keeps telling the swap guard about the run from the Design view', async () => {
    const set = vi.fn();
    const events = new HeldEvents();
    await openPage({
      ports: fakeNextPorts({ readEvents: events.readEvents }),
      swapRisk: { set, get: () => ({ draft: false, run: false }) },
    });
    await startRun(events);

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    });

    expect(set).toHaveBeenLastCalledWith({ draft: false, run: true });
  });

  it('follows the kept run once after a reload, and reads it one way', async () => {
    const events = new HeldEvents();
    await openPage({
      ports: fakeNextPorts({ readEvents: events.readEvents }),
      runMemory: {
        recall: () => RUN_ID,
        remember: () => undefined,
        forget: () => undefined,
      },
    });

    await act(async () => {
      fireEvent.click(runTab());
    });

    expect(events.calls).toEqual([{ runId: RUN_ID, after: 0 }]);
  });

  it('tells the swap guard that a run is going', async () => {
    const set = vi.fn();
    const events = new HeldEvents();
    await openPage({
      ports: fakeNextPorts({ readEvents: events.readEvents }),
      swapRisk: { set, get: () => ({ draft: false, run: false }) },
    });

    await startRun(events);

    expect(set).toHaveBeenCalledWith({ draft: false, run: true });
  });

  it('announces where the run is in the one live region', async () => {
    const events = new HeldEvents();
    await openPage({
      ports: fakeNextPorts({ readEvents: events.readEvents }),
    });

    await startRun(events);

    expect(screen.getAllByTestId('run-live-status')).toHaveLength(1);
    expect(screen.getByTestId('run-live-status').textContent).toContain(
      'Running draft.',
    );
  });
});

describe('the check of a text', () => {
  const nameBox = () =>
    within(screen.getByRole('tabpanel', { name: 'Properties' })).getByRole(
      'textbox',
      { name: 'name' },
    ) as HTMLInputElement;

  const openProperties = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));
    });
  };

  const type = async (text: string) => {
    await act(async () => {
      fireEvent.change(nameBox(), { target: { value: text } });
    });
  };

  /** The checks made so far, as the page has sent them. */
  const checksOf = (ports: NextPorts) => vi.mocked(ports.validate).mock.calls;

  // Both readers of a check wait for the same pause, so one edit must send
  // one request: the editor judges the draft by the findings of the very
  // answer the view draws.
  it('sends one check for one edit, and none of the editor own', async () => {
    const { ports, edits } = await openPage();
    await openProperties();
    // The view checks the file as it was loaded when it opens; this is about
    // what one edit adds to that.
    const before = checksOf(ports).length;

    await type('drafting');
    await act(async () => {});

    expect(checksOf(ports).slice(before)).toHaveLength(1);
    expect(edits.check).not.toHaveBeenCalled();
  });

  // The editor's reader of a check cannot call it off, so a later edit must
  // not cut the call short under it: it would read the abort as a server that
  // did not answer and refuse every changed stage.
  it('starts its own check for a later edit and leaves the one before it to finish', async () => {
    const { ports } = await openPage();
    await openProperties();
    const before = checksOf(ports).length;
    await type('drafting');
    await act(async () => {});

    await type('drafted');
    await act(async () => {});

    const [first, second] = checksOf(ports).slice(before);
    expect(first?.[0].text).not.toBe(second?.[0].text);
    expect(first?.[1].aborted).toBe(false);
    expect(second?.[1].aborted).toBe(false);
  });

  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  const isOff = (element: HTMLElement) =>
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true';

  /** A check that answers when the test says so, and reports its calls. */
  function heldChecks() {
    const calls: { text: string; signal: AbortSignal }[] = [];
    const answers: ((answer: CheckAnswer) => void)[] = [];
    let answered = 0;
    const validate = vi.fn((request: ValidateRequest, signal: AbortSignal) => {
      calls.push({ text: request.text, signal });
      return new Promise<CheckAnswer>((resolve, reject) => {
        answers.push(resolve);
        // A call whose signal aborts fails, as the request behind it does.
        signal.addEventListener(
          'abort',
          () => reject(new Error('The check was called off.')),
          { once: true },
        );
      });
    });
    /** Answers every call that is still waiting. */
    const settleAll = (answer: CheckAnswer) => {
      for (; answered < answers.length; answered += 1) {
        answers[answered]?.(answer);
      }
    };
    return { calls, settleAll, validate };
  }

  const CLEAN: CheckAnswer = {
    errors: 0,
    warnings: 0,
    infos: 0,
    view: null,
    diagnostics: [],
  };

  const BROKEN: CheckAnswer = {
    errors: 1,
    warnings: 0,
    infos: 0,
    view: null,
    diagnostics: [
      {
        code: 'UNKNOWN_AGENT',
        severity: 'error',
        path: 'stages[0].agent',
        line: 8,
        column: 5,
        end_line: 8,
        end_column: 16,
        message: 'No agent is named drafting.',
      },
    ],
  };

  // The editor judges the draft by the findings of the check it waits for,
  // and the Run view takes the Design view off the page, so the reader that
  // gives up there must not take the editor's answer with it. Save is open
  // while a check is out, so what the loss costs is the findings: without
  // them the editor never hears that the draft is broken, and no later check
  // of it is made.
  it('answers the editor when the Run view takes the Design view off', async () => {
    const server = heldChecks();
    await openPage({
      ports: fakeNextPorts({ validate: server.validate }),
    });
    await openProperties();
    // The page checks the file as it was loaded when it opens; this is about
    // the check of the edit that follows.
    await act(async () => server.settleAll(CLEAN));
    const before = server.calls.length;

    await type('drafting');
    await act(async () => {});
    const edited = server.calls[before]?.text;
    expect(server.calls).toHaveLength(before + 1);
    expect(isOff(saveButton())).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Run' }));
    });
    await act(async () => server.settleAll(BROKEN));

    // The editor read the findings of the call it was already waiting for:
    // nothing was asked again for that text.
    expect(server.calls).toHaveLength(before + 1);
    expect(server.calls[before]?.text).toBe(edited);
    // Back on the Design view, Save is closed on the broken draft. The view
    // reads the text it shows again when it opens, which the editor does not
    // need: it has judged this draft.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    });

    expect(isOff(saveButton())).toBe(true);
  });
});

describe('the Run view while the fields of the workflow are not known', () => {
  const GOAL = 'Fix the build';

  /** Opens the page on the Run view with that answer for the extras read. */
  async function onRunView(loadExtras: NextPorts['loadExtras']) {
    const page = await openPage({
      ports: fakeNextPorts({ loadExtras }),
    });
    await act(async () => {
      fireEvent.click(runTab());
    });
    return page;
  }

  const runButton = () => screen.getByRole('button', { name: 'Run' });

  const typeGoal = async (text: string) => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Goal'), {
        target: { value: text },
      });
    });
  };

  const isOff = (button: HTMLElement) =>
    button.hasAttribute('disabled') ||
    button.getAttribute('aria-disabled') === 'true';

  it('keeps Run off, and starts nothing, while the read is still going', async () => {
    const { ports } = await onRunView(
      () => new Promise<WorkflowExtras>(() => undefined),
    );

    await typeGoal(GOAL);

    expect(isOff(runButton())).toBe(true);
    expect(runButton().textContent).toContain('still being read');
    await act(async () => {
      fireEvent.click(runButton());
    });
    expect(ports.startRun).not.toHaveBeenCalled();
  });

  it('keeps Run off, and starts nothing, after a read that failed', async () => {
    const { ports } = await onRunView(() =>
      Promise.reject(new Error('The server said no.')),
    );
    await act(async () => {});

    await typeGoal(GOAL);

    expect(isOff(runButton())).toBe(true);
    expect(runButton().textContent).toContain('The server said no.');
    await act(async () => {
      fireEvent.click(runButton());
    });
    expect(ports.startRun).not.toHaveBeenCalled();
  });

  it('turns Run on once the read answers, and starts with the typed goal', async () => {
    const { ports } = await onRunView(() => Promise.resolve(FAKE_EXTRAS));

    await typeGoal(GOAL);

    expect(isOff(runButton())).toBe(false);
    await act(async () => {
      fireEvent.click(runButton());
    });
    expect(ports.startRun).toHaveBeenCalledWith(
      'hello',
      { goal: GOAL },
      expect.anything(),
    );
  });
});

describe('the Run view when the agents cannot be listed', () => {
  const GOAL = 'Fix the build';

  async function onRunView(listAgents: NextPorts['listAgents']) {
    const page = await openPage({
      ports: fakeNextPorts({ listAgents }),
    });
    await act(async () => {
      fireEvent.click(runTab());
    });
    return page;
  }

  const runButton = () => screen.getByRole('button', { name: 'Run' });

  const typeGoal = async (text: string) => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Goal'), {
        target: { value: text },
      });
    });
  };

  const isOff = (button: HTMLElement) =>
    button.hasAttribute('disabled') ||
    button.getAttribute('aria-disabled') === 'true';

  // The Run view needs no agent: a list that is still coming, or one the
  // server would not give, must not hold up a workflow whose inputs are known.
  it('runs while the list is still coming', async () => {
    const { ports } = await onRunView(
      () => new Promise<readonly AgentOption[]>(() => undefined),
    );

    await typeGoal(GOAL);

    expect(isOff(runButton())).toBe(false);
    await act(async () => {
      fireEvent.click(runButton());
    });
    expect(ports.startRun).toHaveBeenCalledWith(
      'hello',
      { goal: GOAL },
      expect.anything(),
    );
  });

  it('runs after the list failed, and says why the list is short', async () => {
    const { ports } = await onRunView(() =>
      Promise.reject(new Error('No agent list.')),
    );

    await typeGoal(GOAL);

    expect(isOff(runButton())).toBe(false);
    await act(async () => {
      fireEvent.click(runButton());
    });
    expect(ports.startRun).toHaveBeenCalledWith(
      'hello',
      { goal: GOAL },
      expect.anything(),
    );
    expect(screen.getByTestId('next-data-error').textContent).toContain(
      'No agent list.',
    );
  });
});
