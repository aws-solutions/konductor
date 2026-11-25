// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import {
  RunAlreadyActive,
  RunNeedsTrust,
  type RunMemory,
} from '../execution/core/ports';
import type { RunParams } from './run-params';
import { useRunStart } from './use-run-start';
const RUN_ID = '20261024-0412-a7b3c';

/** The params of a run of a workflow that declares nothing but the goal. */
const GOAL_ONLY: RunParams = { goal: 'Add a greeting' };

function fakeMemory(kept?: string) {
  const state = { kept };
  const memory: RunMemory = {
    recall: () => state.kept,
    remember: (id) => {
      state.kept = id;
    },
    forget: () => {
      state.kept = undefined;
    },
  };
  return { memory, state };
}

const held = () => {
  let settle: (runId: string) => void = () => undefined;
  const promise = new Promise<string>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

describe('useRunStart', () => {
  it('begins idle without a kept run', () => {
    const { result } = renderHook(() =>
      useRunStart({ port: { start: vi.fn() } }),
    );

    expect(result.current.start).toEqual({ kind: 'idle' });
  });

  it('follows the run that memory kept, as after a reload', () => {
    const { memory } = fakeMemory(RUN_ID);

    const { result } = renderHook(() =>
      useRunStart({ port: { start: vi.fn() }, memory }),
    );

    expect(result.current.start).toEqual({
      kind: 'going',
      runId: RUN_ID,
      joined: true,
    });
  });

  it('keeps the run it started, so a reload finds it', async () => {
    const { memory, state } = fakeMemory();
    const start = vi.fn(() => Promise.resolve(RUN_ID));
    const { result } = renderHook(() =>
      useRunStart({ port: { start }, memory }),
    );

    await act(async () => result.current.begin(GOAL_ONLY));

    expect(state.kept).toBe(RUN_ID);
    expect(result.current.start).toEqual({
      kind: 'going',
      runId: RUN_ID,
      joined: false,
    });
  });

  it('keeps the run that was already going, so a reload finds it too', async () => {
    const { memory, state } = fakeMemory();
    const start = vi.fn(() =>
      Promise.reject(new RunAlreadyActive('Busy.', RUN_ID)),
    );
    const { result } = renderHook(() =>
      useRunStart({ port: { start }, memory }),
    );

    await act(async () => result.current.begin(GOAL_ONLY));

    expect(state.kept).toBe(RUN_ID);
  });

  it('starts one run while a start is in flight', async () => {
    const call = held();
    const start = vi.fn(() => call.promise);
    const { result } = renderHook(() => useRunStart({ port: { start } }));

    await act(async () => result.current.begin({ goal: 'one' }));
    await act(async () => result.current.begin({ goal: 'two' }));

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.start).toEqual({ kind: 'starting' });
  });

  it('forgets the run without changing what the view shows', async () => {
    const { memory, state } = fakeMemory(RUN_ID);
    const { result } = renderHook(() =>
      useRunStart({ port: { start: vi.fn() }, memory }),
    );

    await act(async () => result.current.forget());

    expect(state.kept).toBeUndefined();
    expect(result.current.start).toEqual({
      kind: 'going',
      runId: RUN_ID,
      joined: true,
    });
  });

  it('keeps the run it took up through every later render', async () => {
    const { memory, state } = fakeMemory(RUN_ID);
    const port = { start: vi.fn() };
    const { result, rerender } = renderHook(() =>
      useRunStart({ port, memory }),
    );
    await act(async () => result.current.forget());

    rerender();
    await act(async () => {});

    expect(state.kept).toBeUndefined();
    expect(result.current.start).toEqual({
      kind: 'going',
      runId: RUN_ID,
      joined: true,
    });
  });

  it('takes up no run when the memory of the source kept none', async () => {
    const { memory } = fakeMemory();
    const port = { start: vi.fn() };
    const { result, rerender } = renderHook(() =>
      useRunStart({ port, memory }),
    );

    rerender();
    await act(async () => {});

    expect(result.current.start).toEqual({ kind: 'idle' });
  });

  it('starts again from the new memory when the session is replaced', async () => {
    const first = fakeMemory(RUN_ID);
    const second = fakeMemory('20261024-0500-zzzzz');
    const start = vi.fn(() => Promise.resolve(RUN_ID));
    const { result, rerender } = renderHook(
      ({ memory }: { memory: RunMemory }) =>
        useRunStart({ port: { start }, memory }),
      { initialProps: { memory: first.memory } },
    );

    rerender({ memory: second.memory });
    await act(async () => {});

    expect(result.current.start).toEqual({
      kind: 'going',
      runId: '20261024-0500-zzzzz',
      joined: true,
    });
    expect(first.state.kept).toBeUndefined();
  });

  it('drops the run of the workflow that was left when the start call changes', async () => {
    const { memory, state } = fakeMemory(RUN_ID);
    const { result, rerender } = renderHook(
      ({ start }: { start: () => Promise<string> }) =>
        useRunStart({ port: { start }, memory }),
      { initialProps: { start: vi.fn(() => Promise.resolve(RUN_ID)) } },
    );

    rerender({ start: vi.fn(() => Promise.resolve('20261024-0500-zzzzz')) });
    await act(async () => {});

    expect(state.kept).toBeUndefined();
    expect(result.current.start).toEqual({ kind: 'idle' });
  });

  it('shows no run of the workflow that was left while a start is in flight', async () => {
    const { memory } = fakeMemory();
    const first = vi.fn(() => new Promise<string>(() => undefined));
    const { result, rerender } = renderHook(
      ({ start }: { start: typeof first }) =>
        useRunStart({ port: { start }, memory }),
      { initialProps: { start: first } },
    );
    await act(async () => result.current.begin(GOAL_ONLY));
    expect(result.current.start).toEqual({ kind: 'starting' });

    rerender({ start: vi.fn(() => new Promise<string>(() => undefined)) });
    await act(async () => {});

    expect(result.current.start).toEqual({ kind: 'idle' });
  });

  it('aborts the start in flight when the session is replaced', async () => {
    const seen: AbortSignal[] = [];
    const first = vi.fn((_params: RunParams, signal: AbortSignal) => {
      seen.push(signal);
      return new Promise<string>(() => undefined);
    });
    const { result, rerender } = renderHook(
      ({ start }: { start: typeof first }) => useRunStart({ port: { start } }),
      { initialProps: { start: first } },
    );
    await act(async () => result.current.begin(GOAL_ONLY));

    rerender({ start: vi.fn(() => new Promise<string>(() => undefined)) });
    await act(async () => {});

    expect(seen[0]?.aborted).toBe(true);
    expect(result.current.start).toEqual({ kind: 'idle' });
  });

  it('keeps a run that has ended out of the next workflow', async () => {
    const { memory, state } = fakeMemory();
    const start = vi.fn(() => Promise.resolve(RUN_ID));
    const { result, rerender } = renderHook(
      ({ port }: { port: { start: typeof start } }) =>
        useRunStart({ port, memory }),
      { initialProps: { port: { start } } },
    );
    await act(async () => result.current.begin(GOAL_ONLY));
    result.current.forget();

    rerender({ port: { start: vi.fn(() => Promise.resolve('x')) } });
    await act(async () => {});

    expect(state.kept).toBeUndefined();
    expect(result.current.start).toEqual({ kind: 'idle' });
  });

  it('sets no state after it is unmounted', async () => {
    const call = held();
    const start = vi.fn(() => call.promise);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() =>
      useRunStart({ port: { start } }),
    );
    await act(async () => result.current.begin(GOAL_ONLY));

    unmount();
    await act(async () => {
      call.settle(RUN_ID);
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says what to do about a server that may have stopped, as the Execution tab does', async () => {
    const start = vi.fn(() =>
      Promise.reject(new ApiError('The server did not answer.', 503)),
    );
    const { result } = renderHook(() => useRunStart({ port: { start } }));

    await act(async () => result.current.begin(GOAL_ONLY));

    expect(result.current.start).toEqual({
      kind: 'failed',
      message:
        'The server did not answer. If it stopped, start `flow view` again and open the address it prints.',
    });
  });

  describe('a start refused because the workflow is not trusted', () => {
    const FIX =
      'Run `konductor flow trust hello` in a terminal, then try again.';
    const refuse = () =>
      vi.fn(() =>
        Promise.reject(new RunNeedsTrust('The workflow is not trusted.', FIX)),
      );

    it('keeps the fix and the goal that was sent, as the first refusal', async () => {
      const start = refuse();
      const { result } = renderHook(() => useRunStart({ port: { start } }));

      await act(async () => result.current.begin(GOAL_ONLY));

      expect(result.current.start).toEqual({
        kind: 'trust',
        message: 'The workflow is not trusted.',
        fix: FIX,
        goal: 'Add a greeting',
        params: GOAL_ONLY,
        refusal: 1,
      });
    });

    it('gives the next refusal its own number, so its dialog opens afresh', async () => {
      const start = refuse();
      const { result } = renderHook(() => useRunStart({ port: { start } }));
      await act(async () => result.current.begin(GOAL_ONLY));
      await act(async () => result.current.closeTrust(1));

      await act(async () => result.current.begin(GOAL_ONLY));

      expect(result.current.start).toMatchObject({
        kind: 'trust',
        refusal: 2,
      });
      expect(result.current.start).not.toHaveProperty('closed');
    });

    it('counts from one again after a start that failed for another reason', async () => {
      const call = { fail: refuse() };
      const start = vi.fn(() => call.fail());
      const { result } = renderHook(() => useRunStart({ port: { start } }));
      await act(async () => result.current.begin(GOAL_ONLY));
      call.fail = vi.fn(() => Promise.reject(new Error('The server said no.')));
      await act(async () => result.current.begin(GOAL_ONLY));
      call.fail = refuse();

      await act(async () => result.current.begin(GOAL_ONLY));

      expect(result.current.start).toMatchObject({ kind: 'trust', refusal: 1 });
    });

    it('marks the refusal closed when its dialog is closed', async () => {
      const start = refuse();
      const { result } = renderHook(() => useRunStart({ port: { start } }));
      await act(async () => result.current.begin(GOAL_ONLY));

      await act(async () => result.current.closeTrust(1));

      expect(result.current.start).toMatchObject({ refusal: 1, closed: true });
    });

    it('ignores a close that names another refusal', async () => {
      const start = refuse();
      const { result } = renderHook(() => useRunStart({ port: { start } }));
      await act(async () => result.current.begin(GOAL_ONLY));

      await act(async () => result.current.closeTrust(7));

      expect(result.current.start).not.toMatchObject({ closed: true });
    });
  });
});
