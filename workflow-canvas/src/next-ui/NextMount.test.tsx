// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { WorkflowExtras } from '../api/workflow-extras';
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
  render(
    <App
      load={Promise.resolve(loaded(HELLO_DOCUMENT, runs, acceptingEdits()))}
      scheduler={scheduler}
      nextUi={nextUi}
      nextPortsFor={() => ports}
      {...(swapRisk ? { swapRisk } : {})}
      {...(runMemory ? { runMemory } : {})}
    />,
  );
  await act(async () => {});
  return { ports, scheduler, runs };
}

const runTab = () => screen.getByRole('tab', { name: 'Run' });

describe('the page without ?ui=next', () => {
  it('draws the Designer that the page has today', async () => {
    await openPage({ nextUi: false });

    expect(screen.getByTestId('node-end')).toBeTruthy();
    expect(screen.queryByTestId('raw-edit-note')).toBeNull();
  });

  it('reads none of the calls of the views being built', async () => {
    const { ports } = await openPage({ nextUi: false });

    expect(ports.loadExtras).not.toHaveBeenCalled();
    expect(ports.listAgents).not.toHaveBeenCalled();
  });

  it('keeps the Run tab it has today', async () => {
    await openPage({ nextUi: false });

    await act(async () => {
      fireEvent.click(runTab());
    });

    expect(screen.getByTestId('run-status')).toBeTruthy();
  });
});

describe('the page with ?ui=next', () => {
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

describe('the run lifecycle with ?ui=next', () => {
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
    const { runs } = await openPage({
      nextUi: true,
      ports: portsOf({ readEvents: events.readEvents }),
    });

    await startRun(events);

    expect(runs.start).toHaveBeenCalledTimes(1);
    // The controller of the Run tab reads `GET /api/runs/{id}`; nothing may.
    expect(runs.get).not.toHaveBeenCalled();
    expect(events.calls.length).toBeGreaterThan(0);
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

  it('keeps the live regions of the page it had without the query', async () => {
    await openPage({ nextUi: false });

    expect(screen.getAllByTestId('run-live-status')).toHaveLength(1);
    expect(screen.getAllByTestId('run-live-alert')).toHaveLength(1);
  });
});
