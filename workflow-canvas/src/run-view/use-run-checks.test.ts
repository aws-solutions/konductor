// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CheckStates } from '../execution/core/run-checks';
import { useRunChecks } from './use-run-checks';

const RUN_ID = '20261024-0412-a7b3c';

const VERIFIED: CheckStates = { 'readme-exists': 'verified' };

const settle = () => act(async () => {});

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
