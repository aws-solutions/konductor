// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunStartUnsure } from '../execution/core';
import { EventWaits, HeldEvents } from '../test-support/held-events';
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
    scheduler: new EventWaits(),
    now: () => NOW,
    ...over,
  };
  const { result } = renderHook(() =>
    useRunController({ stages: STAGES, ports }),
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
