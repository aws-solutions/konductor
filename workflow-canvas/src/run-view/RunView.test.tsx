// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  RunAlreadyActive,
  RunStartUnsure,
  type RunMemory,
} from '../execution/core/ports';
import type { RunSummaryRow } from '../execution/core/run-history';
import {
  EventWaits,
  HeldEvents,
  blocked,
  eventsAnswer,
  finished,
  passed,
  running,
} from '../test-support/held-events';
import { RunView } from './RunView';
import type { RunLifecycle } from './run-start';
import { useRunController, type RunViewPorts } from './use-run-controller';

/**
 * The view with the controller the page holds for it, so these tests drive
 * the two together, as the page does.
 */
function Drawn({
  stages,
  goalDefault,
  ports,
  runMemory,
  reasonSentence,
  onRunState,
}: {
  stages: readonly string[];
  goalDefault?: string;
  ports: RunViewPorts;
  runMemory?: RunMemory;
  reasonSentence?: (code: string) => string | undefined;
  onRunState?: (state: RunLifecycle) => void;
}) {
  const controller = useRunController({
    stages,
    ...(goalDefault === undefined ? {} : { goalDefault }),
    ports,
    ...(runMemory ? { runMemory } : {}),
  });
  onRunState?.(controller.lifecycle);
  return (
    <RunView
      controller={controller}
      {...(reasonSentence ? { reasonSentence } : {})}
    />
  );
}

const RUN_ID = '20261024-0412-a7b3c';
const STAGES = ['draft', 'review'];
const GOAL_DEFAULT = 'Add a greeting to the README';
// Five seconds before the `at` of the run_finished event below.
const NOW = Date.parse('2026-10-24T04:12:00Z');

const settle = () => act(async () => {});

const historyRow = (over: Partial<RunSummaryRow> = {}): RunSummaryRow => ({
  run_id: RUN_ID,
  started_at: '2026-10-24T04:12:05Z',
  status: 'running',
  goal: GOAL_DEFAULT,
  goal_truncated: false,
  ...over,
});

// A memory like the page's, which keeps the run across a reload.
function memoryOf(runId?: string): RunMemory {
  let kept = runId;
  return {
    recall: () => kept,
    remember: (id) => {
      kept = id;
    },
    forget: () => {
      kept = undefined;
    },
  };
}
function drawn({
  startResult = Promise.resolve(RUN_ID),
  runs = [] as readonly RunSummaryRow[],
  listFails,
  memory,
  reasonSentence,
  goalDefault = GOAL_DEFAULT,
  noGoalDefault = false,
  clock,
  onRunState,
}: {
  startResult?: Promise<string>;
  runs?: readonly RunSummaryRow[];
  listFails?: string;
  memory?: RunMemory;
  reasonSentence?: (code: string) => string | undefined;
  goalDefault?: string;
  /** The workflow declares no default goal. */
  noGoalDefault?: boolean;
  /** A clock the test moves, for the elapsed time. */
  clock?: { now: () => number };
  /** Told where the run is, as the page is. */
  onRunState?: (state: RunLifecycle) => void;
} = {}) {
  const events = new HeldEvents();
  const waits = new EventWaits();
  const start = vi.fn(() => startResult);
  const listRuns = vi.fn(() =>
    listFails === undefined
      ? Promise.resolve(runs)
      : Promise.reject(new Error(listFails)),
  );
  const ports: RunViewPorts = {
    start,
    readEvents: events.readEvents,
    listRuns,
    scheduler: waits,
    now: clock ? clock.now : () => NOW,
  };
  const view = (
    <Drawn
      stages={STAGES}
      {...(noGoalDefault ? {} : { goalDefault })}
      ports={ports}
      {...(memory ? { runMemory: memory } : {})}
      {...(reasonSentence ? { reasonSentence } : {})}
      {...(onRunState ? { onRunState } : {})}
    />
  );
  const { rerender } = render(view);
  /** Draws the view again with the same calls, as any state change does. */
  const rerenderSame = () => rerender(view);
  /**
   * Draws the view again, as the page does when it opens another workflow:
   * fresh calls of the new session, and its own default goal.
   */
  const rerenderWith = ({
    goalDefault: nextDefault = goalDefault,
  }: {
    goalDefault?: string;
  }) => {
    const nextEvents = new HeldEvents();
    const nextStart = vi.fn(() => startResult);
    const nextList = vi.fn(() => Promise.resolve(runs));
    rerender(
      <Drawn
        stages={STAGES}
        goalDefault={nextDefault}
        ports={{
          start: nextStart,
          readEvents: nextEvents.readEvents,
          listRuns: nextList,
          scheduler: waits,
          now: clock ? clock.now : () => NOW,
        }}
        {...(memory ? { runMemory: memory } : {})}
      />,
    );
    return { events: nextEvents, start: nextStart, listRuns: nextList };
  };
  return { events, start, listRuns, waits, rerenderWith, rerenderSame };
}

const goalBox = () => screen.getByRole('textbox') as HTMLInputElement;
const runButton = () => screen.getByRole('button', { name: 'Run' });
const followAgainButton = () =>
  screen.getByRole('button', { name: 'Follow again' });
// The error under the Goal box. The disabled Run button says the same
// sentence in its own tooltip, so the box is read by its class.
const goalError = () =>
  document.querySelector('[class*="error__message"]')?.textContent;
const isOff = (button: HTMLElement) =>
  button.hasAttribute('disabled') ||
  button.getAttribute('aria-disabled') === 'true';

async function type(text: string) {
  await act(async () => {
    fireEvent.change(goalBox(), { target: { value: text } });
  });
}

async function press() {
  await act(async () => {
    fireEvent.click(runButton());
  });
}

async function answer(events: HeldEvents, body: unknown, status = 200) {
  await act(async () => {
    events.answer(body, status);
  });
}

describe('RunView before a run', () => {
  it('fills the Goal box with the default goal of the workflow', () => {
    drawn();

    expect(goalBox().value).toBe(GOAL_DEFAULT);
  });

  it('keeps what the person types', async () => {
    drawn();

    await type('Fix the build');

    expect(goalBox().value).toBe('Fix the build');
  });

  it('turns Run off for an empty goal', async () => {
    drawn();

    await type('');

    expect(isOff(runButton())).toBe(true);
  });

  it('says there is no run yet and reads no events', () => {
    const { events } = drawn();

    expect(screen.getByText('No run yet.')).toBeTruthy();
    expect(events.calls).toEqual([]);
  });

  it('lists the past runs it read', async () => {
    drawn({ runs: [historyRow({ status: 'passed' })] });

    await settle();

    expect(screen.getAllByTestId('run-history-row')).toHaveLength(1);
  });

  it('says so when the past runs cannot be read', async () => {
    drawn({ listFails: 'The server said no.' });

    await settle();

    expect(screen.getByTestId('run-history-error').textContent).toContain(
      'The server said no.',
    );
  });
});

describe('RunView when a run starts', () => {
  it('starts the run with the goal in the box and follows it', async () => {
    const { events, start } = drawn();

    await press();

    expect(start).toHaveBeenCalledWith(GOAL_DEFAULT, expect.anything());
    expect(events.calls).toEqual([{ runId: RUN_ID, after: 0 }]);
  });

  it('starts the run on Enter in the Goal box', async () => {
    const { start } = drawn();

    await act(async () => {
      fireEvent.keyDown(goalBox(), { key: 'Enter' });
    });

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('turns Run off while the run goes on', async () => {
    drawn();

    await press();

    expect(isOff(runButton())).toBe(true);
  });

  it('starts one run for two presses', async () => {
    const { start } = drawn({ startResult: new Promise(() => undefined) });

    await press();
    await press();

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('shows every stage of the workflow as queued', async () => {
    drawn();

    await press();

    expect(screen.getByRole('button', { name: /draft/ }).textContent).toContain(
      'Queued',
    );
  });

  it('says why a start failed, and lets the person try again', async () => {
    drawn({ startResult: Promise.reject(new Error('The server said no.')) });

    await press();

    expect(screen.getByTestId('run-start-error').textContent).toContain(
      'The server said no.',
    );
    expect(isOff(runButton())).toBe(false);
  });

  it('follows the run that was already going, with its goal unknown', async () => {
    drawn({
      startResult: Promise.reject(new RunAlreadyActive('Busy.', RUN_ID)),
    });

    await press();

    expect(goalBox().value).toBe('');
    expect(screen.getByText(/goal is not known here/)).toBeTruthy();
  });

  it('asks for a reload when it cannot tell whether the run started', async () => {
    drawn({ startResult: Promise.reject(new RunStartUnsure('No answer.')) });

    await press();

    expect(screen.getByTestId('run-start-error').textContent).toContain(
      'Reload the page',
    );
    expect(isOff(runButton())).toBe(true);
  });

  it('tells the page a run may be going when a start is unsure', async () => {
    const told: RunLifecycle[] = [];
    drawn({
      startResult: Promise.reject(new RunStartUnsure('No answer.')),
      onRunState: (state) => told.push(state),
    });

    await press();

    // The server may have taken the start, so the swap guard must still warn.
    const last = told.at(-1);
    expect(last?.active).toBe(true);
    expect(last?.error).toContain('No answer.');
  });
});

describe('RunView while a run goes on', () => {
  it('shows a run that reaches Passed, and offers another run', async () => {
    const { events } = drawn();
    await press();

    await answer(
      events,
      eventsAnswer(
        [
          running(1, 'draft'),
          passed(2, 'draft'),
          running(3, 'review'),
          passed(4, 'review'),
          finished(5, 'passed'),
        ],
        { done: true },
      ),
    );

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Run passed.',
    );
    expect(isOff(runButton())).toBe(false);
  });

  it('times the run from the first event to its end', async () => {
    const { events } = drawn();
    await press();

    await answer(events, eventsAnswer([finished(1, 'passed')], { done: true }));

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Elapsed 0:05',
    );
  });

  it('shows the stage that stopped the run with its reason', async () => {
    const { events } = drawn({
      reasonSentence: (code) =>
        code === 'RESULT_MISSING'
          ? 'The stage left no result behind.'
          : undefined,
    });
    await press();

    await answer(
      events,
      eventsAnswer(
        [
          running(1, 'draft'),
          blocked(2, 'draft', 'RESULT_MISSING'),
          finished(3, 'halted'),
        ],
        { done: true },
      ),
    );

    expect(screen.getByText('The stage left no result behind.')).toBeTruthy();
  });

  it('reads the past runs again once the run has ended', async () => {
    const { events, listRuns } = drawn();
    await press();
    const before = listRuns.mock.calls.length;

    await answer(events, eventsAnswer([finished(1, 'passed')], { done: true }));

    expect(listRuns.mock.calls.length).toBeGreaterThan(before);
  });

  it('adds no live region of its own', async () => {
    const { events } = drawn();
    await press();

    await answer(events, eventsAnswer([running(1, 'draft')]));

    expect(document.querySelector('[aria-live]')).toBeNull();
  });
});

describe('RunView after a reload', () => {
  it('follows the run that the page kept, without starting one', async () => {
    const { events, start } = drawn({ memory: memoryOf(RUN_ID) });

    await settle();

    expect(start).not.toHaveBeenCalled();
    expect(events.calls).toEqual([{ runId: RUN_ID, after: 0 }]);
  });

  it('shows the goal of that run as not known while it goes on', async () => {
    drawn({ memory: memoryOf(RUN_ID) });

    await settle();

    expect(goalBox().value).toBe('');
  });

  it('shows how far the kept run has got', async () => {
    const { events } = drawn({
      memory: memoryOf(RUN_ID),
      runs: [historyRow()],
    });
    await settle();

    await answer(
      events,
      eventsAnswer([passed(1, 'draft'), running(2, 'review')]),
    );

    expect(screen.getByTestId('run-progress').textContent).toContain('review');
  });

  it('gives the Goal box back once the kept run has ended, with the default goal', async () => {
    const memory = memoryOf(RUN_ID);
    const { events } = drawn({ memory });
    await settle();

    await answer(events, eventsAnswer([finished(1, 'passed')], { done: true }));

    expect(goalBox().value).toBe(GOAL_DEFAULT);
    expect(goalBox().readOnly).toBe(false);
    expect(isOff(runButton())).toBe(false);
  });

  it('keeps Run off for a workflow with no default goal until one is typed', async () => {
    const memory = memoryOf(RUN_ID);
    const { events } = drawn({ memory, noGoalDefault: true });
    await settle();

    await answer(events, eventsAnswer([finished(1, 'passed')], { done: true }));

    expect(goalBox().value).toBe('');
    expect(isOff(runButton())).toBe(true);
    await type('Fix the build');
    expect(isOff(runButton())).toBe(false);
  });

  it('forgets the kept run once it has ended, so a reload starts afresh', async () => {
    const memory = memoryOf(RUN_ID);
    const { events } = drawn({ memory });
    await settle();

    await answer(events, eventsAnswer([finished(1, 'passed')], { done: true }));

    expect(memory.recall()).toBeUndefined();
  });

  it('keeps the run that ended on show, with its stages and its past runs', async () => {
    const { events } = drawn({
      memory: memoryOf(RUN_ID),
      runs: [historyRow({ status: 'passed' })],
    });
    await settle();

    await answer(
      events,
      eventsAnswer(
        [passed(1, 'draft'), passed(2, 'review'), finished(3, 'passed')],
        { done: true },
      ),
    );

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Run passed.',
    );
    expect(screen.queryByText('No run yet.')).toBeNull();
    expect(screen.getByRole('button', { name: /draft/ })).toBeTruthy();
    expect(screen.getAllByTestId('run-history-row')).toHaveLength(1);
  });

  it('forgets the kept run when it can no longer be followed', async () => {
    const memory = memoryOf(RUN_ID);
    const { events } = drawn({ memory });
    await settle();

    while (events.waiting) {
      await act(async () => {
        events.drop();
      });
    }

    expect(memory.recall()).toBeUndefined();
  });

  it('forgets the kept run when the server no longer knows the session', async () => {
    const memory = memoryOf(RUN_ID);
    const { events } = drawn({ memory });
    await settle();

    await answer(events, { error: 'The session is gone.' }, 401);

    expect(memory.recall()).toBeUndefined();
  });
});

describe('RunView when the run ends without a last event', () => {
  // The server can report a run as over in a read that brings no
  // `run_finished`, and the run has ended all the same.
  const endWithoutEvent = async (events: HeldEvents) => {
    await answer(events, eventsAnswer([running(1, 'draft')], { done: true }));
    if (events.waiting) await answer(events, eventsAnswer([], { done: true }));
  };

  it('offers another run', async () => {
    const { events } = drawn();
    await press();

    await endWithoutEvent(events);

    expect(isOff(runButton())).toBe(false);
  });

  it('reads the past runs again', async () => {
    const { events, listRuns } = drawn();
    await press();
    const before = listRuns.mock.calls.length;

    await endWithoutEvent(events);

    expect(listRuns.mock.calls.length).toBeGreaterThan(before);
  });

  it('forgets the run, so a reload does not take it up again', async () => {
    const memory = memoryOf();
    const { events } = drawn({ memory });
    await press();
    expect(memory.recall()).toBe(RUN_ID);

    await endWithoutEvent(events);

    expect(memory.recall()).toBeUndefined();
  });

  it('says the run ended instead of naming a stage at work', async () => {
    const { events } = drawn();
    await press();

    await endWithoutEvent(events);

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'The run ended.',
    );
  });

  it('shows the stage it was reading as not finished', async () => {
    const { events } = drawn();
    await press();

    await endWithoutEvent(events);

    expect(screen.getByRole('button', { name: /draft/ }).textContent).toContain(
      'Not finished',
    );
  });

  it('says that no more console lines can come', async () => {
    const { events } = drawn();
    await press();

    await endWithoutEvent(events);

    expect(screen.getByText('No live output is available.')).toBeTruthy();
  });

  it('says what to do about the goal, not that a run is in progress', async () => {
    const { events } = drawn();
    await press();
    await endWithoutEvent(events);

    await type('');

    expect(isOff(runButton())).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Run' }).textContent,
    ).not.toContain('A run is in progress.');
  });
});

describe('RunView when the page opens another workflow', () => {
  it('shows the default goal of the new workflow, not the text typed for the one before', async () => {
    const { rerenderWith } = drawn();
    await type('Fix the build');
    expect(goalBox().value).toBe('Fix the build');

    const other = rerenderWith({ goalDefault: 'Write the release note' });

    expect(goalBox().value).toBe('Write the release note');
    await press();
    expect(other.start).toHaveBeenCalledWith(
      'Write the release note',
      expect.anything(),
    );
  });

  it('keeps what was typed while the workflow stays the same', async () => {
    const { rerenderSame } = drawn();
    await type('Fix the build');

    rerenderSame();

    expect(goalBox().value).toBe('Fix the build');
  });
});

describe('RunView, the elapsed time', () => {
  it('moves on through a stage that sends nothing', async () => {
    const clock = { at: NOW, now: () => clock.at };
    const { events, waits } = drawn({ clock });
    await press();
    await answer(events, eventsAnswer([running(1, 'draft')]));

    clock.at = NOW + 3000;
    await act(async () => {
      waits.passSecond();
    });

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Elapsed 0:03',
    );
  });

  it('stops reading the clock once the run has ended', async () => {
    const clock = { at: NOW, now: () => clock.at };
    const { events, waits } = drawn({ clock });
    await press();
    await answer(events, eventsAnswer([running(1, 'draft')]));
    expect(waits.pendingTicks).toBe(1);

    await answer(events, eventsAnswer([finished(2, 'passed')], { done: true }));

    expect(waits.pendingTicks).toBe(0);
  });
});

describe('RunView when the server is gone', () => {
  it('says the run is no longer followed once the reads give up', async () => {
    const { events } = drawn();
    await press();

    while (events.waiting) {
      await act(async () => {
        events.drop();
      });
    }

    expect(screen.getByTestId('run-follow-error').textContent).toContain(
      'did not answer',
    );
  });

  it('says so when the server no longer knows the session', async () => {
    const { events } = drawn();
    await press();

    await answer(events, { error: 'The session is gone.' }, 401);

    expect(screen.getByTestId('run-session-error').textContent).toContain(
      'The session is gone.',
    );
  });

  it('offers Follow again and keeps Run shut once the reads give up', async () => {
    const { events } = drawn();
    await press();

    while (events.waiting) {
      await act(async () => {
        events.drop();
      });
    }
    const alert = screen.getByTestId('run-follow-error');

    expect(alert.textContent).toContain('Follow it again');
    expect(alert.textContent).toContain('reload the page');
    expect(isOff(runButton())).toBe(true);
    expect(followAgainButton()).toBeTruthy();
  });

  it('reads the run on when Follow again is pressed', async () => {
    const { events } = drawn();
    await press();

    while (events.waiting) {
      await act(async () => {
        events.drop();
      });
    }
    await act(async () => {
      fireEvent.click(followAgainButton());
    });

    expect(screen.queryByTestId('run-follow-error')).toBeNull();
    await answer(events, eventsAnswer([running(1, 'draft')]));
    expect(screen.getByTestId('run-progress').textContent).toContain('draft');
  });
});

describe('RunView, the Goal box of a workflow with no default goal', () => {
  it('shows no error before the person has typed', () => {
    drawn({ noGoalDefault: true });

    expect(goalBox().value).toBe('');
    expect(goalError()).toBeUndefined();
    expect(isOff(runButton())).toBe(true);
    expect(runButton().textContent).toContain('Enter a goal to run.');
  });

  it('shows the error once the person has typed and emptied the box', async () => {
    drawn({ noGoalDefault: true });

    await type('Plan it');
    expect(goalError()).toBeUndefined();

    await type('');

    expect(goalError()).toBe('Enter a goal to run.');
  });
});

describe('the Run view and the controller the page keeps', () => {
  // The page holds the controller, so the view can come and go, as it does
  // when a person looks at the Design view and comes back.
  function Page({ shown, ports }: { shown: boolean; ports: RunViewPorts }) {
    const controller = useRunController({
      stages: STAGES,
      goalDefault: GOAL_DEFAULT,
      ports,
    });
    return shown ? <RunView controller={controller} /> : <p>Another view</p>;
  }

  function opened() {
    const events = new HeldEvents();
    const ports: RunViewPorts = {
      start: vi.fn(() => Promise.resolve(RUN_ID)),
      readEvents: events.readEvents,
      listRuns: vi.fn(() => Promise.resolve([])),
      scheduler: new EventWaits(),
      now: () => NOW,
    };
    const { rerender } = render(<Page shown ports={ports} />);
    const show = (shown: boolean) =>
      act(async () => {
        rerender(<Page shown={shown} ports={ports} />);
      });
    return { events, ports, show };
  }

  it('follows the run while the view is off the page, and shows what came', async () => {
    const { events, show } = opened();
    await press();
    await answer(events, eventsAnswer([running(1, 'draft')]));

    await show(false);
    // The events of the run go on arriving with no view to draw them.
    await answer(
      events,
      eventsAnswer([passed(2, 'draft'), running(3, 'review')]),
    );
    await show(true);

    expect(screen.getByTestId('run-progress').textContent).toContain('review');
    expect(events.waiting).toBe(true);
  });

  it('shows a run that ended while the view was off the page', async () => {
    const { events, show } = opened();
    await press();
    await answer(events, eventsAnswer([running(1, 'draft')]));

    await show(false);
    await answer(
      events,
      eventsAnswer(
        [passed(2, 'draft'), passed(3, 'review'), finished(4, 'passed')],
        { done: true },
      ),
    );
    await show(true);

    expect(screen.getByTestId('run-progress').textContent).toContain(
      'Run passed.',
    );
  });

  it('keeps reading the run, so the follower is not aborted', async () => {
    const { events, show } = opened();
    await press();
    await answer(events, eventsAnswer([running(1, 'draft')]));

    await show(false);

    // The read of the next events is still out: nothing took it off.
    expect(events.waiting).toBe(true);
    expect(events.calls.length).toBeGreaterThan(1);
  });
});
