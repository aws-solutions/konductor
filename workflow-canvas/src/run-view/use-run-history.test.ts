// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunSummaryRow } from '../execution/core/run-history';
import { useRunHistory, type ListRuns } from './use-run-history';

const row = (runId: string): RunSummaryRow => ({
  run_id: runId,
  started_at: '2026-10-24T04:12:05Z',
  status: 'passed',
  goal: 'Add a greeting',
  goal_truncated: false,
});

const ROWS = [row('20261024-0412-a7b3c')];

describe('useRunHistory', () => {
  it('lists nothing without a session', () => {
    const { result } = renderHook(() => useRunHistory({ list: undefined }));

    expect(result.current).toEqual({ runs: [] });
  });

  it('reads the runs once', async () => {
    const list: ListRuns = vi.fn(() => Promise.resolve(ROWS));

    const { result } = renderHook(() => useRunHistory({ list }));
    await act(async () => {});

    expect(result.current.runs).toEqual(ROWS);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads them again when the caller asks', async () => {
    const list: ListRuns = vi.fn(() => Promise.resolve(ROWS));
    const { rerender } = renderHook(
      ({ reread }: { reread: string }) => useRunHistory({ list, reread }),
      { initialProps: { reread: 'live' } },
    );
    await act(async () => {});

    rerender({ reread: 'ended' });
    await act(async () => {});

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not read again while the caller asks for the same', async () => {
    const list: ListRuns = vi.fn(() => Promise.resolve(ROWS));
    const { rerender } = renderHook(() =>
      useRunHistory({ list, reread: 'live' }),
    );
    await act(async () => {});

    rerender();
    await act(async () => {});

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps the runs it had read when a later read fails', async () => {
    let fail = false;
    const list: ListRuns = () =>
      fail ? Promise.reject(new Error('Gone.')) : Promise.resolve(ROWS);
    const { result, rerender } = renderHook(
      ({ reread }: { reread: string }) => useRunHistory({ list, reread }),
      { initialProps: { reread: 'first' } },
    );
    await act(async () => {});

    fail = true;
    rerender({ reread: 'second' });
    await act(async () => {});

    expect(result.current.runs).toEqual(ROWS);
    expect(result.current.failure).toBe('Gone.');
  });

  it('shows no runs of the workflow that was left while the new read is pending', async () => {
    const first: ListRuns = () => Promise.resolve(ROWS);
    const { result, rerender } = renderHook(
      ({ list }: { list: ListRuns }) => useRunHistory({ list }),
      { initialProps: { list: first } },
    );
    await act(async () => {});
    expect(result.current.runs).toEqual(ROWS);

    const held: ListRuns = () => new Promise(() => undefined);
    rerender({ list: held });

    expect(result.current.runs).toEqual([]);
  });

  it('shows the runs of the new workflow once its read answers', async () => {
    const other = [row('20261024-0500-zzzzz')];
    const { result, rerender } = renderHook(
      ({ list }: { list: ListRuns }) => useRunHistory({ list }),
      { initialProps: { list: () => Promise.resolve(ROWS) } },
    );
    await act(async () => {});

    rerender({ list: () => Promise.resolve(other) });
    await act(async () => {});

    expect(result.current.runs).toEqual(other);
  });

  it('shows no runs of the workflow that was left when the new read fails', async () => {
    const { result, rerender } = renderHook(
      ({ list }: { list: ListRuns }) => useRunHistory({ list }),
      { initialProps: { list: () => Promise.resolve(ROWS) } },
    );
    await act(async () => {});

    rerender({ list: () => Promise.reject(new Error('Gone.')) });
    await act(async () => {});

    expect(result.current.runs).toEqual([]);
    expect(result.current.failure).toBe('Gone.');
  });

  it('aborts the read in flight when it is unmounted', async () => {
    const seen: AbortSignal[] = [];
    const list: ListRuns = (signal) => {
      seen.push(signal);
      return new Promise(() => undefined);
    };
    const { unmount } = renderHook(() => useRunHistory({ list }));

    unmount();

    expect(seen[0]?.aborted).toBe(true);
  });
});
