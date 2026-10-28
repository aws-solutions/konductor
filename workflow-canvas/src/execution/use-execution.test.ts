// SPDX-License-Identifier: Apache-2.0
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { helloRun } from '../test-support/fixtures';
import { RunReadRefused, type RunMemory, type RunPort } from './core';
import { useExecution } from './use-execution';

const RUN_ID = helloRun(0).runId;

function runsThatEnd(): RunPort {
  return {
    start: vi.fn().mockResolvedValue(RUN_ID),
    get: vi.fn().mockResolvedValue(helloRun(2)),
  };
}

const emptyMemory = (runId?: string): RunMemory => ({
  recall: () => runId,
  remember: vi.fn(),
  forget: vi.fn(),
});

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
    forget: vi.fn(),
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

    expect(runs.get).toHaveBeenCalledWith(RUN_ID, expect.any(AbortSignal));
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

describe('useExecution when the remembered run cannot be looked up', () => {
  const memoryOf = (runId: string): RunMemory => ({
    recall: () => runId,
    remember: vi.fn(),
    forget: vi.fn(),
  });

  it('stays at rest when the server will not give the run', async () => {
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockRejectedValue(new RunReadRefused('Gone.')),
    };
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memoryOf(RUN_ID)),
    );
    await act(async () => {});

    expect(result.current.state).toEqual({ phase: 'idle' });
  });

  it('says the run may be going when the server does not answer', async () => {
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error('The server did not answer.')),
    };
    const scheduler = new FakeScheduler();
    const { result } = renderHook(() =>
      useExecution(runs, scheduler, memoryOf(RUN_ID)),
    );

    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => scheduler.tick());
    }

    expect(result.current.state).toEqual({
      phase: 'error',
      message: 'The server did not answer.',
      started: true,
      runId: RUN_ID,
    });
  });
});

describe('useExecution while a run of the memory is being looked for', () => {
  const memoryOf = (runId?: string): RunMemory => ({
    recall: vi.fn(() => runId),
    remember: vi.fn(),
    forget: vi.fn(),
  });

  /** A server whose first read of the remembered run never answers. */
  function slowToAnswer() {
    const runs: RunPort = {
      start: vi.fn().mockResolvedValue(RUN_ID),
      get: vi.fn(
        (_id: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) =>
            signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            ),
          ),
      ),
    };
    return runs;
  }

  it('starts the run when Run is pressed, instead of ignoring the click', async () => {
    const runs = slowToAnswer();
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memoryOf(RUN_ID)),
    );
    await act(async () => {});
    expect(runs.get).toHaveBeenCalledOnce();

    await act(async () => result.current.start('Ship it'));

    expect(runs.start).toHaveBeenCalledWith('Ship it', expect.any(AbortSignal));
    expect(result.current.state.phase).not.toBe('idle');
  });

  it('stops looking for the earlier run when Run is pressed', async () => {
    const runs = slowToAnswer();
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memoryOf(RUN_ID)),
    );
    await act(async () => {});
    const lookup = (runs.get as ReturnType<typeof vi.fn>).mock
      .calls[0]![1] as AbortSignal;

    await act(async () => result.current.start('Ship it'));

    expect(lookup.aborted).toBe(true);
  });

  it('ignores a second click once the run is under way', async () => {
    const runs = slowToAnswer();
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memoryOf(RUN_ID)),
    );
    await act(async () => {});

    await act(async () => {
      result.current.start('Ship it');
      result.current.start('Ship it');
    });

    expect(runs.start).toHaveBeenCalledOnce();
  });

  it('ignores Run once the earlier run has been found and is being followed', async () => {
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockResolvedValue(helloRun(1)),
    };
    const scheduler = new FakeScheduler();
    const memory = memoryOf(RUN_ID);
    const { result } = renderHook(() => useExecution(runs, scheduler, memory));
    await waitFor(() => expect(result.current.state.phase).toBe('following'));

    await act(async () => result.current.start('Ship it'));

    expect(runs.start).not.toHaveBeenCalled();
  });
});

describe('useExecution and the memory', () => {
  it('remembers no run when the run does not start', async () => {
    const memory: RunMemory = {
      recall: () => undefined,
      remember: vi.fn(),
      forget: vi.fn(),
    };
    const runs: RunPort = {
      start: vi.fn().mockRejectedValue(new Error('kiro-cli is not installed.')),
      get: vi.fn(),
    };
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memory),
    );

    await act(async () => result.current.start('Ship it'));

    expect(memory.remember).not.toHaveBeenCalled();
  });

  it('forgets the run once it has ended', async () => {
    const memory = { ...emptyMemory(), forget: vi.fn() };
    const { result } = renderHook(() =>
      useExecution(runsThatEnd(), new FakeScheduler(), memory),
    );

    await act(async () => result.current.start('Ship it'));

    expect(memory.forget).toHaveBeenCalledOnce();
  });

  it('keeps the run in the memory while it goes on', async () => {
    const memory = { ...emptyMemory(), forget: vi.fn() };
    const runs: RunPort = {
      start: vi.fn().mockResolvedValue(RUN_ID),
      get: vi.fn().mockResolvedValue(helloRun(1)),
    };
    const { result } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memory),
    );

    await act(async () => result.current.start('Ship it'));

    expect(memory.forget).not.toHaveBeenCalled();
  });

  it.each([
    ['has ended', () => Promise.resolve(helloRun(2))],
    ['is gone', () => Promise.reject(new RunReadRefused('Gone.'))],
  ])(
    'forgets a remembered run that %s when the page is opened again',
    async (_, get) => {
      const memory = { ...emptyMemory(RUN_ID), forget: vi.fn() };
      const runs: RunPort = { start: vi.fn(), get: vi.fn(get) };

      renderHook(() => useExecution(runs, new FakeScheduler(), memory));
      await act(async () => {});

      expect(memory.forget).toHaveBeenCalledOnce();
    },
  );

  it('keeps a remembered run that could not be looked up', async () => {
    const memory = { ...emptyMemory(RUN_ID), forget: vi.fn() };
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error('The server did not answer.')),
    };
    const scheduler = new FakeScheduler();

    renderHook(() => useExecution(runs, scheduler, memory));
    for (let turn = 0; turn < 3; turn += 1) {
      await act(async () => scheduler.tick());
    }

    expect(memory.forget).not.toHaveBeenCalled();
  });

  it('keeps a remembered run when the look for it is stopped', async () => {
    const memory = { ...emptyMemory(RUN_ID), forget: vi.fn() };
    const runs: RunPort = {
      start: vi.fn(),
      get: vi.fn(
        (_id: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) =>
            signal.addEventListener('abort', () =>
              reject(new Error('stopped')),
            ),
          ),
      ),
    };

    const { unmount } = renderHook(() =>
      useExecution(runs, new FakeScheduler(), memory),
    );
    await act(async () => {});
    unmount();
    await act(async () => {});

    expect(memory.forget).not.toHaveBeenCalled();
  });
});

describe('useExecution when the runs change', () => {
  it('goes on following a run that it joined', async () => {
    const memory = emptyMemory(RUN_ID);
    const scheduler = new FakeScheduler();
    const joined: RunPort = {
      start: vi.fn(),
      get: vi
        .fn()
        .mockResolvedValueOnce(helloRun(1))
        .mockResolvedValue(helloRun(2)),
    };
    const { result, rerender } = renderHook(
      ({ runs }) => useExecution(runs, scheduler, memory),
      { initialProps: { runs: joined } },
    );
    await waitFor(() => expect(result.current.state.phase).toBe('following'));
    const other: RunPort = {
      start: vi.fn(),
      get: vi.fn().mockResolvedValue(helloRun(2)),
    };

    rerender({ runs: other });
    await act(async () => scheduler.tick());

    expect(joined.get).toHaveBeenCalledTimes(2);
    expect(result.current.state.phase).toBe('finished');
  });
});
