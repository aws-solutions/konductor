// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timerScheduler } from './timer-scheduler';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function track(promise: Promise<void>) {
  const state = { done: false };
  void promise.then(() => {
    state.done = true;
  });
  return state;
}

describe('timerScheduler', () => {
  it('resolves once the time has passed, and not before', async () => {
    const state = track(
      timerScheduler.wait(1000, new AbortController().signal),
    );

    await vi.advanceTimersByTimeAsync(999);
    expect(state.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.done).toBe(true);
  });

  it('resolves at once when the signal aborts, and leaves no timer behind', async () => {
    const abort = new AbortController();
    const state = track(timerScheduler.wait(1000, abort.signal));

    abort.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(state.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves at once when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();

    const state = track(timerScheduler.wait(1000, abort.signal));
    await vi.advanceTimersByTimeAsync(0);

    expect(state.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
