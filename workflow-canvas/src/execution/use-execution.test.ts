// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { helloRun } from '../test-support/fixtures';
import type { RunPort } from './core';
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
