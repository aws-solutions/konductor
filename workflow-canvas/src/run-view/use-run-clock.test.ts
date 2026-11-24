// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { RUN_TICK_MS, useRunClock } from './use-run-clock';

function clockFrom(start: number, step = 1000) {
  const state = { at: start };
  return {
    now: () => state.at,
    pass: (ms = step) => {
      state.at += ms;
    },
  };
}

describe('useRunClock', () => {
  it('reads the clock once while it does not tick', () => {
    const clock = clockFrom(1000);
    const scheduler = new FakeScheduler();

    const { result } = renderHook(() =>
      useRunClock({ scheduler, now: clock.now, ticking: false }),
    );

    expect(result.current).toBe(1000);
    expect(scheduler.pendingCount).toBe(0);
  });

  it('reads it again after each wait while the run goes on', async () => {
    const clock = clockFrom(1000);
    const scheduler = new FakeScheduler();
    const { result } = renderHook(() =>
      useRunClock({ scheduler, now: clock.now, ticking: true }),
    );

    clock.pass();
    await act(async () => {
      scheduler.tick();
    });

    expect(scheduler.waits[0]).toBe(RUN_TICK_MS);
    expect(result.current).toBe(2000);
  });

  it('keeps moving through a stage that sends nothing', async () => {
    const clock = clockFrom(1000);
    const scheduler = new FakeScheduler();
    const { result } = renderHook(() =>
      useRunClock({ scheduler, now: clock.now, ticking: true }),
    );

    for (let tick = 0; tick < 3; tick += 1) {
      clock.pass();
      await act(async () => {
        scheduler.tick();
      });
    }

    expect(result.current).toBe(4000);
  });

  it('waits for one tick at a time', async () => {
    const clock = clockFrom(1000);
    const scheduler = new FakeScheduler();
    renderHook(() => useRunClock({ scheduler, now: clock.now, ticking: true }));

    await act(async () => {});

    expect(scheduler.pendingCount).toBe(1);
  });

  it('stops when the run ends, and keeps the time it last read', async () => {
    const clock = clockFrom(1000);
    const scheduler = new FakeScheduler();
    const { result, rerender } = renderHook(
      ({ ticking }: { ticking: boolean }) =>
        useRunClock({ scheduler, now: clock.now, ticking }),
      { initialProps: { ticking: true } },
    );
    clock.pass();
    await act(async () => {
      scheduler.tick();
    });

    rerender({ ticking: false });
    clock.pass();
    await act(async () => {
      scheduler.tick();
    });

    expect(scheduler.pendingCount).toBe(0);
    expect(result.current).toBe(2000);
  });

  it('stops when the view unmounts', async () => {
    const clock = clockFrom(1000);
    const scheduler = new FakeScheduler();
    const { unmount } = renderHook(() =>
      useRunClock({ scheduler, now: clock.now, ticking: true }),
    );
    await act(async () => {});

    unmount();

    expect(scheduler.pendingCount).toBe(0);
  });
});
