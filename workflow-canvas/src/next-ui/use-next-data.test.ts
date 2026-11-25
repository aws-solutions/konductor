// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowExtras } from '../api/workflow-extras';
import { KNOWN_AGENTS } from '../designer/core';
import type { NextPorts } from './next-http';
import { useNextData } from './use-next-data';

const EXTRAS: WorkflowExtras = {
  stageFields: { agent: [{ key: 'name', type: 'name', required: true }] },
  goalDefault: 'Say hello',
};

const AGENTS = [{ id: 'k-developer', summary: 'Code' }];

const RUN_STARTED = '20261024-0412-a7b3c';

function portsOf(over: Partial<NextPorts> = {}): NextPorts {
  return {
    loadExtras: vi.fn(() => Promise.resolve(EXTRAS)),
    listAgents: vi.fn(() => Promise.resolve(AGENTS)),
    listRuns: vi.fn(() => Promise.resolve([])),
    startRun: vi.fn(() => Promise.resolve(RUN_STARTED)),
    readEvents: vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      }),
    ),
    validate: vi.fn(() =>
      Promise.resolve({
        errors: 0,
        warnings: 0,
        infos: 0,
        view: null,
        diagnostics: [],
      }),
    ),
    ...over,
  };
}

describe('useNextData', () => {
  it('reads nothing without ports, and offers the agents this page knows', () => {
    const { result } = renderHook(() => useNextData({ ports: undefined }));

    expect(result.current.extras).toEqual({ stageFields: {} });
    expect(result.current.agents).toBe(KNOWN_AGENTS);
  });

  it('reads the fields and the agents of the workflow', async () => {
    const ports = portsOf();

    const { result } = renderHook(() => useNextData({ ports }));
    await act(async () => {});

    expect(result.current.extras).toEqual(EXTRAS);
    expect(result.current.agents).toEqual(AGENTS);
  });

  it('reads them again after a save, which moves the lines of the stages', async () => {
    const ports = portsOf();
    const { rerender } = renderHook(
      ({ reload }: { reload: string }) => useNextData({ ports, reload }),
      { initialProps: { reload: 'hash-1' } },
    );
    await act(async () => {});

    rerender({ reload: 'hash-2' });
    await act(async () => {});

    expect(ports.loadExtras).toHaveBeenCalledTimes(2);
  });

  it('has nothing while the read for a new reload value is in flight', async () => {
    // The fields of the workflow as it was before the save are not the ones
    // it has now, so no view may draw from them while the reread is out.
    let answer: (extras: WorkflowExtras) => void = () => undefined;
    const held = new Promise<WorkflowExtras>((resolve) => {
      answer = resolve;
    });
    const loadExtras = vi
      .fn<NextPorts['loadExtras']>()
      .mockResolvedValueOnce(EXTRAS)
      .mockReturnValueOnce(held);
    const ports = portsOf({ loadExtras });
    const { result, rerender } = renderHook(
      ({ reload }: { reload: string }) => useNextData({ ports, reload }),
      { initialProps: { reload: 'hash-1' } },
    );
    await act(async () => {});

    rerender({ reload: 'hash-2' });
    await act(async () => {});

    expect(result.current.extras).toEqual({ stageFields: {} });
    expect(result.current.agents).toBe(KNOWN_AGENTS);
    expect(result.current.failure).toBeUndefined();

    // Once it answers, the fields of the workflow as it is now are there.
    await act(async () => {
      answer({ stageFields: {}, goalDefault: 'Ship it' });
      await held;
    });

    expect(result.current.extras.goalDefault).toBe('Ship it');
  });

  it('says why the reads failed', async () => {
    const ports = portsOf({
      loadExtras: vi.fn(() => Promise.reject(new Error('The server said no.'))),
    });

    const { result } = renderHook(() => useNextData({ ports }));
    await act(async () => {});

    expect(result.current.failure).toBe('The server said no.');
    expect(result.current.extras).toEqual({ stageFields: {} });
  });

  it('aborts the reads in flight when it is unmounted', async () => {
    const seen: AbortSignal[] = [];
    const ports = portsOf({
      loadExtras: (signal) => {
        if (signal) seen.push(signal);
        return new Promise(() => undefined);
      },
    });
    const { unmount } = renderHook(() => useNextData({ ports }));

    unmount();

    expect(seen[0]?.aborted).toBe(true);
  });
});

describe('useNextData, whether what it holds is what the server said', () => {
  const held = () => new Promise<WorkflowExtras>(() => undefined);

  it('is not ready while the first read is going', async () => {
    const ports = portsOf({ loadExtras: held });
    const { result } = renderHook(() => useNextData({ ports }));
    await act(async () => {});

    expect(result.current.ready).toBe(false);
  });

  it('is ready once the read answers', async () => {
    const ports = portsOf();
    const { result } = renderHook(() => useNextData({ ports }));
    await act(async () => {});

    expect(result.current.ready).toBe(true);
    expect(result.current.extras).toEqual(EXTRAS);
  });

  it('is not ready after a read that failed', async () => {
    const ports = portsOf({
      loadExtras: () => Promise.reject(new Error('The server said no.')),
    });
    const { result } = renderHook(() => useNextData({ ports }));
    await act(async () => {});

    expect(result.current.ready).toBe(false);
    expect(result.current.failure).toBe('The server said no.');
  });

  it('is not ready while a fresh read after a save is going', async () => {
    const ports = portsOf({ loadExtras: held });
    const { result, rerender } = renderHook(
      ({ reload }: { reload: string }) => useNextData({ ports, reload }),
      { initialProps: { reload: 'h1' } },
    );
    await act(async () => {});

    rerender({ reload: 'h2' });
    await act(async () => {});

    expect(result.current.ready).toBe(false);
  });

  it('is not ready without a session', () => {
    const { result } = renderHook(() => useNextData({ ports: undefined }));

    expect(result.current.ready).toBe(false);
  });
});
