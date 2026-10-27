// SPDX-License-Identifier: Apache-2.0
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { helloRun } from '../test-support/fixtures';
import type { RunMemory, RunPort } from './core';
import { useExecution } from './use-execution';

const RUN_ID = helloRun(0).runId;

function runsThatEnd(): RunPort {
  return {
    start: vi.fn().mockResolvedValue(RUN_ID),
    get: vi.fn().mockResolvedValue(helloRun(2)),
  };
}

describe('useExecution', () => {
  it('starts one run when start is called twice before anything renders', async () => {
    const runs = runsThatEnd();
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler()),
    );

    await act(async () => {
      result.current.start('Ship it');
      result.current.start('Ship it');
    });

    expect(runs.start).toHaveBeenCalledOnce();
  });

  it('starts again once the run has ended', async () => {
    const runs = runsThatEnd();
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler()),
    );
    await act(async () => result.current.start('Ship it'));

    await act(async () => result.current.start('Ship it'));

    expect(runs.start).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a connection to a server', () => {
    const { result } = renderHook(() =>
      useExecution(undefined, new FakeScheduler()),
    );

    act(() => result.current.start('Ship it'));

    expect(result.current.state).toEqual({ phase: 'idle' });
  });
});

describe('useExecution after a reload', () => {
  const memoryOf = (runId?: string): RunMemory => ({
    recall: vi.fn(() => runId),
    remember: vi.fn(),
  });

  it('joins the run that the memory names when that run is still going', async () => {
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockResolvedValue(helloRun(1)),
    };

    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memoryOf(RUN_ID)),
    );

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        phase: 'following',
        runId: RUN_ID,
        joined: true,
      }),
    );
    expect(runs.start).not.toHaveBeenCalled();
  });

  it('stays ready when the run of the memory has ended', async () => {
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockResolvedValue(helloRun(2)),
    };

    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memoryOf(RUN_ID)),
    );
    await act(async () => {});

    expect(runs.get).toHaveBeenCalledWith(RUN_ID);
    expect(result.current.state).toEqual({ phase: 'idle' });
  });

  it('reads nothing when the memory is empty', async () => {
    const runs = runsThatEnd();

    renderHook(() => useExecution(runs, new FakeScheduler(), memoryOf()));
    await act(async () => {});

    expect(runs.get).not.toHaveBeenCalled();
  });

  it('remembers the id of the run that it starts and of the run that it joins', async () => {
    const memory = memoryOf();
    const { result } = renderHook(() =>
      useExecution(runsThatEnd(), new FakeScheduler(), memory),
    );

    await act(async () => result.current.start('Ship it'));

    expect(memory.remember).toHaveBeenCalledWith(RUN_ID);
  });
});
