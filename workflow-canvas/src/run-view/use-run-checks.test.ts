// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CheckStates, ReadChecks } from '../execution/core/run-checks';
import { useRunChecks } from './use-run-checks';

const RUN_ID = '20261024-0412-a7b3c';

const VERIFIED: CheckStates = { 'readme-exists': 'verified' };

const settle = () => act(async () => {});

/**
 * Reads that the test answers when it chooses, so one can be held across a
 * change of key, run or reader and answered after it was aborted.
 */
class HeldChecks {
  readonly calls: { runId: string; signal: AbortSignal }[] = [];
  private readonly held: ((states: CheckStates) => void)[] = [];

  readonly read: ReadChecks = (runId, signal) => {
    this.calls.push({ runId, signal });
    return new Promise<CheckStates>((resolve, reject) => {
      this.held.push(resolve);
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
  };

  /** The reads whose signal has not been aborted. */
  get live(): number {
    return this.calls.filter((call) => !call.signal.aborted).length;
  }

  /** Answers the call made at `at`, however long ago it was made. */
  async answer(states: CheckStates, at = 0): Promise<void> {
    const resolve = this.held[at];
    if (!resolve) throw new Error(`No read was made at ${at}.`);
    resolve(states);
    await settle();
  }
}

describe('useRunChecks', () => {
  it('reads nothing without a run', async () => {
    const read = vi.fn(() => Promise.resolve(VERIFIED));

    const { result } = renderHook(() =>
      useRunChecks({ read, runId: undefined }),
    );
    await settle();

    expect(read).not.toHaveBeenCalled();
    expect(result.current.states).toEqual({});
  });

  it('reads nothing without a session', async () => {
    const { result } = renderHook(() =>
      useRunChecks({ read: undefined, runId: RUN_ID }),
    );
    await settle();

    expect(result.current.states).toEqual({});
  });

  it('reads the states of the run', async () => {
    const read = vi.fn((runId: string) =>
      Promise.resolve(runId === RUN_ID ? VERIFIED : {}),
    );

    const { result } = renderHook(() => useRunChecks({ read, runId: RUN_ID }));
    await settle();

    expect(read.mock.calls[0]?.[0]).toBe(RUN_ID);
    expect(result.current.states).toEqual(VERIFIED);
  });

  it('reads again when the key changes, and not before', async () => {
    const read = vi.fn(() => Promise.resolve(VERIFIED));
    const { rerender } = renderHook(
      ({ reread }: { reread: string }) =>
        useRunChecks({ read, runId: RUN_ID, reread }),
      { initialProps: { reread: 'a' } },
    );
    await settle();

    rerender({ reread: 'a' });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    rerender({ reread: 'b' });
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the states it read when a later read fails, and says why', async () => {
    const read = vi
      .fn<(runId: string, signal: AbortSignal) => Promise<CheckStates>>()
      .mockResolvedValueOnce(VERIFIED)
      .mockRejectedValueOnce(new Error('The server said no.'));
    const { result, rerender } = renderHook(
      ({ reread }: { reread: string }) =>
        useRunChecks({ read, runId: RUN_ID, reread }),
      { initialProps: { reread: 'a' } },
    );
    await settle();

    rerender({ reread: 'b' });
    await settle();

    expect(result.current.states).toEqual(VERIFIED);
    expect(result.current.failure).toBe('The server said no.');
  });

  it('shows no state of the run before this one', async () => {
    const read = vi.fn((runId: string) =>
      Promise.resolve(runId === RUN_ID ? VERIFIED : {}),
    );
    const { result, rerender } = renderHook(
      ({ runId }: { runId: string }) => useRunChecks({ read, runId }),
      { initialProps: { runId: RUN_ID } },
    );
    await settle();
    expect(result.current.states).toEqual(VERIFIED);

    rerender({ runId: '20261024-0500-bbbbb' });

    expect(result.current.states).toEqual({});
  });

  it('aborts the read in flight when it is unmounted', async () => {
    const seen: AbortSignal[] = [];
    const read = vi.fn((_runId: string, signal: AbortSignal) => {
      seen.push(signal);
      return new Promise<CheckStates>(() => undefined);
    });
    const { unmount } = renderHook(() => useRunChecks({ read, runId: RUN_ID }));

    unmount();

    expect(seen[0]?.aborted).toBe(true);
  });
});

describe('useRunChecks, the read it has in flight', () => {
  it('aborts it when the key changes, and a late answer sets nothing', async () => {
    const held = new HeldChecks();
    const { result, rerender } = renderHook(
      ({ reread }: { reread: string }) =>
        useRunChecks({ read: held.read, runId: RUN_ID, reread }),
      { initialProps: { reread: 'a' } },
    );
    await settle();

    rerender({ reread: 'b' });
    await settle();

    expect(held.calls[0]?.signal.aborted).toBe(true);
    expect(held.live).toBe(1);

    // The read that was aborted answers after the fact, as a call already in
    // the air does. What it read belongs to the key that was left.
    await held.answer({ 'readme-exists': 'verified' }, 0);

    expect(result.current.states).toEqual({});
  });

  it('aborts it when the run changes, and a late answer sets nothing', async () => {
    const held = new HeldChecks();
    const other = '20261024-0500-bbbbb';
    const { result, rerender } = renderHook(
      ({ runId }: { runId: string }) =>
        useRunChecks({ read: held.read, runId }),
      { initialProps: { runId: RUN_ID } },
    );
    await settle();

    rerender({ runId: other });
    await settle();

    expect(held.calls[0]?.signal.aborted).toBe(true);
    expect(held.calls[1]?.runId).toBe(other);

    await held.answer({ 'readme-exists': 'verified' }, 0);

    expect(result.current.states).toEqual({});
  });

  it('aborts it when the reader changes, and a late answer sets nothing', async () => {
    const first = new HeldChecks();
    const second = new HeldChecks();
    const { result, rerender } = renderHook(
      ({ read }: { read: ReadChecks }) => useRunChecks({ read, runId: RUN_ID }),
      { initialProps: { read: first.read } },
    );
    await settle();

    rerender({ read: second.read });
    await settle();

    expect(first.calls[0]?.signal.aborted).toBe(true);
    expect(second.calls).toHaveLength(1);

    await first.answer({ 'readme-exists': 'verified' }, 0);

    expect(result.current.states).toEqual({});
  });

  it('aborts it on unmount, and a late answer sets no state and warns of nothing', async () => {
    const held = new HeldChecks();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderHook(() =>
      useRunChecks({ read: held.read, runId: RUN_ID }),
    );
    await settle();

    unmount();
    expect(held.calls[0]?.signal.aborted).toBe(true);

    await held.answer({ 'readme-exists': 'verified' }, 0);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('holds one read at a time, however often the key changes', async () => {
    const held = new HeldChecks();
    const { rerender } = renderHook(
      ({ reread }: { reread: string }) =>
        useRunChecks({ read: held.read, runId: RUN_ID, reread }),
      { initialProps: { reread: 'a' } },
    );
    await settle();

    for (const reread of ['b', 'c', 'd']) {
      rerender({ reread });
      await settle();
      expect(held.live, reread).toBe(1);
    }

    expect(held.calls).toHaveLength(4);
  });

  it('takes the answer of the read that is still live', async () => {
    const held = new HeldChecks();
    const { result, rerender } = renderHook(
      ({ reread }: { reread: string }) =>
        useRunChecks({ read: held.read, runId: RUN_ID, reread }),
      { initialProps: { reread: 'a' } },
    );
    await settle();
    rerender({ reread: 'b' });
    await settle();

    await held.answer({ 'tests-pass': 'verified' }, 1);

    expect(result.current.states).toEqual({ 'tests-pass': 'verified' });
  });
});
