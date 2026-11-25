// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { WorkflowExtras } from '../api/workflow-extras';
import type { CheckAnswer, ValidateRequest } from '../designer-view/yaml-draft';
import type { RunMemory, RunPort } from '../execution/core/ports';
import type { SwapRisk } from '../launch/swap-guard';
import { EventWaits, HeldEvents } from '../test-support/held-events';
import { acceptingEdits } from '../test-support/fake-edits';
import { HELLO_DOCUMENT, loaded } from '../test-support/fixtures';
import type { NextPorts } from './next-http';

const RUN_ID = '20261024-0412-a7b3c';

const EXTRAS: WorkflowExtras = {
  stageFields: {
    agent: [
      { key: 'name', type: 'name', required: true },
      { key: 'agent', type: 'name', required: true },
    ],
  },
  goalDefault: 'Add a greeting to the README',
};

function portsOf(over: Partial<NextPorts> = {}): NextPorts {
  return {
    loadExtras: vi.fn(() => Promise.resolve(EXTRAS)),
    listAgents: vi.fn(() =>
      Promise.resolve([{ id: 'k-developer', summary: 'Code' }]),
    ),
    listRuns: vi.fn(() => Promise.resolve([])),
    startRun: vi.fn(() => Promise.resolve(RUN_ID)),
    readEvents: vi.fn(
      () => new Promise<never>(() => undefined),
    ) as unknown as NextPorts['readEvents'],
    validate: vi.fn(() =>
      Promise.resolve({
        errors: 0,
        warnings: 0,
        infos: 0,
        view: null,
        diagnostics: [],
      }),
    ),
    ...over,
  };
}

async function openPage({
  nextUi,
  ports = portsOf(),
  swapRisk,
  runMemory,
}: {
  nextUi: boolean;
  ports?: NextPorts;
  swapRisk?: SwapRisk;
  runMemory?: RunMemory;
}) {
  // The waits of a long poll and of the run clock are held, so a follower
  // reads only what a test answers.
  const scheduler = new EventWaits();
  const runs: RunPort = {
    start: vi.fn(() => Promise.resolve(RUN_ID)),
    get: vi.fn(() => Promise.reject(new Error('The old tab reads no run.'))),
  };
  const edits = acceptingEdits();
  const result = loaded(HELLO_DOCUMENT, runs, edits);
  const portsFor = vi.fn(() => ports);
  render(
    <App
      load={Promise.resolve(result)}
      scheduler={scheduler}
      nextUi={nextUi}
      nextPortsFor={portsFor}
      {...(swapRisk ? { swapRisk } : {})}
      {...(runMemory ? { runMemory } : {})}
    />,
  );
  await act(async () => {});
  return { ports, scheduler, runs, result, portsFor, edits };
}

const runTab = () => screen.getByRole('tab', { name: 'Run' });

describe('the page with ?ui=classic', () => {
  it('draws the Designer it replaced', async () => {
    await openPage({ nextUi: false });

    expect(screen.getByTestId('node-end')).toBeTruthy();
    expect(screen.queryByTestId('raw-edit-note')).toBeNull();
  });

  it('builds no calls of those views', async () => {
    const { portsFor } = await openPage({ nextUi: false });

    expect(portsFor).not.toHaveBeenCalled();
  });

  it('reads none of the calls of the newer views', async () => {
    const { ports } = await openPage({ nextUi: false });

    expect(ports.loadExtras).not.toHaveBeenCalled();
    expect(ports.listAgents).not.toHaveBeenCalled();
  });

  it('keeps the Run tab it replaced', async () => {
    await openPage({ nextUi: false });

    await act(async () => {
      fireEvent.click(runTab());
    });

    expect(screen.getByTestId('run-status')).toBeTruthy();
  });
});

describe('the page as it opens', () => {
  it('builds the calls of the views for the workflow it shows', async () => {
    const { portsFor, result } = await openPage({ nextUi: true });

    // The token of those calls comes from this workflow, not from whichever
    // load answered last.
    expect(portsFor).toHaveBeenCalledTimes(1);
    expect(portsFor).toHaveBeenCalledWith(
      result.ok ? result.workflow : undefined,
    );
  });

  it('draws the Design view, with a stop mark instead of the end node', async () => {
    await openPage({ nextUi: true });

    expect(screen.queryByTestId('node-end')).toBeNull();
    expect(
      screen.getByRole('img', { name: 'The run ends after review' }),
    ).toBeTruthy();
    expect(screen.getByTestId('raw-edit-note')).toBeTruthy();
  });

  it('reads the fields and the agents of the workflow', async () => {
    const { ports } = await openPage({ nextUi: true });

    expect(ports.loadExtras).toHaveBeenCalled();
    expect(ports.listAgents).toHaveBeenCalled();
  });

  it('draws the Run view, with the default goal of the workflow', async () => {
    await openPage({ nextUi: true });

    await act(async () => {
      fireEvent.click(runTab());
    });

    const goal = screen.getByRole('textbox') as HTMLInputElement;
    expect(goal.value).toBe('Add a greeting to the README');
    expect(screen.getByText('No run yet.')).toBeTruthy();
  });

  it('lists the past runs of the workflow', async () => {
    const { ports } = await openPage({ nextUi: true });

    await act(async () => {
      fireEvent.click(runTab());
    });

    expect(ports.listRuns).toHaveBeenCalled();
  });

  it('says so when the fields of the workflow cannot be read', async () => {
    await openPage({
      nextUi: true,
      ports: portsOf({
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

describe('the run lifecycle as the page opens', () => {
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
    const ports = portsOf({ readEvents: events.readEvents });
    const { runs } = await openPage({ nextUi: true, ports });

    await startRun(events);

    // The newer view starts through its own calls, not the session's run
    // port, which the view it replaced used.
    expect(ports.startRun).toHaveBeenCalledTimes(1);
    expect(runs.start).not.toHaveBeenCalled();
    // The controller of the Run tab reads `GET /api/runs/{id}`; nothing may.
    expect(runs.get).not.toHaveBeenCalled();
    expect(events.calls.length).toBeGreaterThan(0);
  });

  it('goes on following the run while the Design view is shown', async () => {
    const events = new HeldEvents();
    await openPage({
      nextUi: true,
      ports: portsOf({ readEvents: events.readEvents }),
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
      nextUi: true,
      ports: portsOf({ readEvents: events.readEvents }),
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
    const { runs } = await openPage({
      nextUi: true,
      ports: portsOf({ readEvents: events.readEvents }),
      runMemory: {
        recall: () => RUN_ID,
        remember: () => undefined,
        forget: () => undefined,
      },
    });

    await act(async () => {
      fireEvent.click(runTab());
    });

    expect(runs.get).not.toHaveBeenCalled();
    expect(events.calls).toEqual([{ runId: RUN_ID, after: 0 }]);
  });

  it('tells the swap guard that a run is going', async () => {
    const set = vi.fn();
    const events = new HeldEvents();
    await openPage({
      nextUi: true,
      ports: portsOf({ readEvents: events.readEvents }),
      swapRisk: { set, get: () => ({ draft: false, run: false }) },
    });

    await startRun(events);

    expect(set).toHaveBeenCalledWith({ draft: false, run: true });
  });

  it('announces where the run is in the one live region', async () => {
    const events = new HeldEvents();
    await openPage({
      nextUi: true,
      ports: portsOf({ readEvents: events.readEvents }),
    });

    await startRun(events);

    expect(screen.getAllByTestId('run-live-status')).toHaveLength(1);
    expect(screen.getByTestId('run-live-status').textContent).toContain(
      'Running draft.',
    );
  });

  it('keeps the live regions of the views it replaced', async () => {
    await openPage({ nextUi: false });

    expect(screen.getAllByTestId('run-live-status')).toHaveLength(1);
    expect(screen.getAllByTestId('run-live-alert')).toHaveLength(1);
  });
});

describe('the check of a text as the page opens', () => {
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
    const { ports, edits } = await openPage({ nextUi: true });
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
    const { ports } = await openPage({ nextUi: true });
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
      nextUi: true,
      ports: portsOf({ validate: server.validate }),
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
