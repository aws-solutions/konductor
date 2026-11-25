// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunStartUnsure } from '../execution/core';
import {
  EventWaits,
  HeldEvents,
  eventsAnswer,
  passed,
  running,
  finished,
} from '../test-support/held-events';
import type { CheckStates, ReadChecks } from '../execution/core/run-checks';
import { UNFOLLOWED_RUN_REASON } from './run-start';
import { useRunController, type RunViewPorts } from './use-run-controller';

const RUN_ID = '20261024-0412-a7b3c';
const STAGES = ['draft', 'review'];
const NOW = Date.parse('2026-10-24T04:12:00Z');

/**
 * The controller as the page holds it, with the reads of a run held so the
 * test answers them.
 */
function following(over: Partial<RunViewPorts> = {}) {
  const events = new HeldEvents();
  const ports: RunViewPorts = {
    start: vi.fn(() => Promise.resolve(RUN_ID)),
    readEvents: events.readEvents,
    listRuns: vi.fn(() => Promise.resolve([])),
    readChecks: vi.fn(() => Promise.resolve({})),
    scheduler: new EventWaits(),
    now: () => NOW,
    ...over,
  };
  const { result } = renderHook(() =>
    useRunController({
      stages: STAGES,
      params: { kind: 'ready', declared: [] },
      ports,
    }),
  );
  const started = async () => {
    await act(async () => result.current.startRun());
  };
  return { events, ports, result, started };
}

describe('useRunController, what it tells the page', () => {
  it('says a run is going once one has started', async () => {
    const { result, started } = following();

    await started();

    expect(result.current.lifecycle.active).toBe(true);
    expect(result.current.lifecycle.error).toBeUndefined();
  });

  // The page has one live region for the run, so the sentence it is given
  // must say what happened, not only what the server said about it.
  it('says the run is no longer followed when the reads fail', async () => {
    const { events, result, started } = following();
    await started();

    while (events.waiting) {
      await act(async () => {
        events.drop();
      });
    }

    expect(result.current.follow.status.kind).toBe('failed');
    expect(result.current.lifecycle.error).toBe(
      'The run is no longer followed. The server did not answer. Check that it is still running.',
    );
  });

  it('says the server no longer knows the session when a read is refused', async () => {
    const { events, result, started } = following();
    await started();

    await act(async () => {
      events.answer({ error: 'The session is gone.' }, 401);
    });

    expect(result.current.follow.status.kind).toBe('session_lost');
    expect(result.current.lifecycle.error).toBe(
      'The server no longer knows this session. The session is gone.',
    );
  });

  it('says nothing went wrong while the run is read', async () => {
    const { events, result, started } = following();
    await started();

    await act(async () => {
      events.answer({
        events: [
          { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
        ],
        next: 1,
        finished: false,
      });
    });

    expect(result.current.lifecycle.error).toBeUndefined();
    expect(result.current.lifecycle.status).toContain('draft');
  });
});

// `lifecycle.active` is what the swap guard reads: it warns that another
// workflow would lose the run of this page. A run nothing follows any more
// is not lost by that swap, and the warning would argue against the fresh
// start the error itself asks for.
describe('useRunController, the run a swap would cost', () => {
  it('counts the run as going while its events are read', async () => {
    const { events, result, started } = following();
    await started();

    await act(async () => {
      events.answer({
        events: [
          { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
        ],
        next: 1,
        finished: false,
      });
    });

    expect(result.current.follow.status.kind).toBe('following');
    expect(result.current.lifecycle.active).toBe(true);
  });

  it('counts no run once the reads have failed', async () => {
    const { events, result, started } = following();
    await started();

    while (events.waiting) {
      await act(async () => {
        events.drop();
      });
    }

    expect(result.current.follow.status.kind).toBe('failed');
    expect(result.current.lifecycle.active).toBe(false);
  });

  it('counts no run once the server has forgotten the session', async () => {
    const { events, result, started } = following();
    await started();

    await act(async () => {
      events.answer({ error: 'The session is gone.' }, 401);
    });

    expect(result.current.follow.status.kind).toBe('session_lost');
    expect(result.current.lifecycle.active).toBe(false);
  });

  // The server may have taken a start whose answer was lost, and no read of
  // it has failed, because there is no run id to read: this page is still
  // the one that would pick it up.
  it('counts a start whose outcome is unknown as a run', async () => {
    const { result, started } = following({
      start: vi.fn(() =>
        Promise.reject(new RunStartUnsure('The answer was lost.')),
      ),
    });

    await started();

    expect(result.current.notice?.header).toBe(
      'It is not known whether the run started.',
    );
    expect(result.current.lifecycle.active).toBe(true);
  });
});

describe('useRunController, a follow that gave up', () => {
  async function gaveUp() {
    const held = following();
    await held.started();
    while (held.events.waiting) {
      await act(async () => {
        held.events.drop();
      });
    }
    expect(held.result.current.follow.status.kind).toBe('failed');
    return held;
  }

  it('keeps Run shut and says to follow again or reload', async () => {
    const { result } = await gaveUp();

    expect(result.current.canStart).toBe(false);
    expect(result.current.disabledReason).toBe(UNFOLLOWED_RUN_REASON);
    expect(result.current.canFollowAgain).toBe(true);
  });

  it('reads the run on from where it stopped when told to follow again', async () => {
    const { events, result } = await gaveUp();

    await act(async () => result.current.followAgain());

    expect(result.current.follow.status.kind).toBe('following');
    expect(result.current.canFollowAgain).toBe(false);
    expect(result.current.disabledReason).toBe('A run is in progress.');
    await act(async () => {
      events.answer({
        events: [
          { seq: 1, type: 'stage_state', stage: 'draft', status: 'running' },
        ],
        next: 1,
        finished: false,
      });
    });

    expect(result.current.lifecycle.status).toContain('draft');
  });

  it('offers no follow again while the run is read', async () => {
    const { result, started } = following();
    await started();

    expect(result.current.canFollowAgain).toBe(false);
    expect(result.current.disabledReason).toBe('A run is in progress.');
  });
});

describe('useRunController, the Goal box error', () => {
  it('holds the goal error back until the person types or asks for a run', async () => {
    const { result, started } = following();

    expect(result.current.goal).toBe('');
    expect(result.current.goalTouched).toBe(false);

    await act(async () => result.current.goalTyped('Plan it'));
    expect(result.current.goalTouched).toBe(true);

    await act(async () => result.current.goalTyped(''));
    expect(result.current.goalTouched).toBe(true);
    await started();
    expect(result.current.goalTouched).toBe(true);
  });

  it('counts a start as having touched the box', async () => {
    const { result, started } = following({ now: () => NOW });

    await started();

    expect(result.current.goalTouched).toBe(true);
  });
});

describe('useRunController, how often it reads the checks of a run', () => {
  /**
   * Reads that never answer, so a test can count them and see that a read it
   * supersedes was aborted rather than left running.
   */
  class HeldChecks {
    readonly calls: { runId: string; signal: AbortSignal }[] = [];

    readonly read: ReadChecks = (runId, signal) => {
      this.calls.push({ runId, signal });
      return new Promise<CheckStates>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    };

    /** The reads whose signal has not been aborted. */
    get live(): number {
      return this.calls.filter((call) => !call.signal.aborted).length;
    }
  }

  it('reads once at the start, once per stage that passes and once at the end', async () => {
    const held = new HeldChecks();
    const { events, started } = following({ readChecks: held.read });
    expect(held.calls).toHaveLength(0);

    await started();
    expect(held.calls, 'at the start').toHaveLength(1);

    // A stage taking up the work changes no check, so nothing is read again.
    await act(async () => events.answer(eventsAnswer([running(1, 'draft')])));
    expect(held.calls, 'draft running').toHaveLength(1);

    // The server runs a stage's checks as it passes, so each pass is read.
    await act(async () => events.answer(eventsAnswer([passed(2, 'draft')])));
    expect(held.calls, 'draft passed').toHaveLength(2);

    await act(async () => events.answer(eventsAnswer([running(3, 'review')])));
    expect(held.calls, 'review running').toHaveLength(2);

    await act(async () => events.answer(eventsAnswer([passed(4, 'review')])));
    expect(held.calls, 'review passed').toHaveLength(3);

    await act(async () =>
      events.answer(eventsAnswer([finished(5, 'passed')], { done: true })),
    );
    expect(held.calls, 'the run ended').toHaveLength(4);

    // Four reads of one run, and no more however long the page is left open.
    expect(held.calls.map((call) => call.runId)).toEqual([
      RUN_ID,
      RUN_ID,
      RUN_ID,
      RUN_ID,
    ]);
  });

  it('holds one read at a time, aborting the one it supersedes', async () => {
    const held = new HeldChecks();
    const { events, started } = following({ readChecks: held.read });

    await started();
    expect(held.live, 'at the start').toBe(1);

    for (const page of [
      eventsAnswer([passed(1, 'draft')]),
      eventsAnswer([passed(2, 'review')]),
      eventsAnswer([finished(3, 'passed')], { done: true }),
    ]) {
      await act(async () => events.answer(page));
      expect(held.live, 'after a read was superseded').toBe(1);
    }

    expect(held.calls).toHaveLength(4);
    expect(
      held.calls.slice(0, -1).every((call) => call.signal.aborted),
      'every superseded read is aborted',
    ).toBe(true);
  });

  it('reads no run before one has started', async () => {
    const held = new HeldChecks();
    following({ readChecks: held.read });

    expect(held.calls).toHaveLength(0);
  });
});
