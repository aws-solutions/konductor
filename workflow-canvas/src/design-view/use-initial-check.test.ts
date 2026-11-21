// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CheckAnswer, CheckRequest } from '../designer-view/yaml-draft';
import { useInitialCheck } from './use-initial-check';

const answerFor = (text: string): CheckAnswer => ({
  errors: 0,
  warnings: 0,
  infos: 0,
  view: {
    format: 'konductor/1',
    version: '0.1.0',
    name: 'hello',
    intent: { outcome: 'Add a greeting' },
    stages: [{ name: 'draft', prompt: text }],
  },
  diagnostics: [],
});

describe('useInitialCheck', () => {
  it('reads the text as loaded, once', async () => {
    const validate = vi.fn(async (request: CheckRequest) =>
      answerFor(request.text),
    );
    const { result, rerender } = renderHook(() =>
      useInitialCheck({ text: 'a', name: 'hello', validate }),
    );
    await act(async () => {});

    rerender();
    await act(async () => {});

    expect(validate).toHaveBeenCalledTimes(1);
    expect(result.current.answer?.view?.stages[0]?.prompt).toBe('a');
    expect(result.current.reading).toBe(false);
  });

  it('sends the name of the workflow with the text', async () => {
    const validate = vi.fn(async (request: CheckRequest) =>
      answerFor(request.text),
    );
    renderHook(() => useInitialCheck({ text: 'a', name: 'hello', validate }));
    await act(async () => {});

    expect(validate.mock.calls[0]?.[0]).toEqual({ name: 'hello', text: 'a' });
  });

  it('leaves the name out when the caller has none', async () => {
    const validate = vi.fn(async (request: CheckRequest) =>
      answerFor(request.text),
    );
    renderHook(() => useInitialCheck({ text: 'a', validate }));
    await act(async () => {});

    expect(validate.mock.calls[0]?.[0]).toEqual({ text: 'a' });
  });

  it('is reading until the answer comes', () => {
    const validate = vi.fn(() => new Promise<CheckAnswer>(() => undefined));

    const { result } = renderHook(() =>
      useInitialCheck({ text: 'a', validate }),
    );

    expect(result.current.reading).toBe(true);
    expect(result.current.answer).toBeUndefined();
  });

  it('says why the check could not be made', async () => {
    const validate = vi.fn(() => Promise.reject(new Error('No answer came.')));

    const { result } = renderHook(() =>
      useInitialCheck({ text: 'a', validate }),
    );
    await act(async () => {});

    expect(result.current.failure).toBe('No answer came.');
    expect(result.current.reading).toBe(false);
  });

  it('reads another text again, and shows no answer of the one before', async () => {
    const validate = vi.fn(async (request: CheckRequest) =>
      answerFor(request.text),
    );
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useInitialCheck({ text, validate }),
      { initialProps: { text: 'a' } },
    );
    await act(async () => {});

    rerender({ text: 'b' });
    expect(result.current.reading).toBe(true);
    await act(async () => {});

    expect(result.current.answer?.view?.stages[0]?.prompt).toBe('b');
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('aborts the check of the text before it', async () => {
    const seen: AbortSignal[] = [];
    const validate = vi.fn((_request: CheckRequest, signal: AbortSignal) => {
      seen.push(signal);
      return new Promise<CheckAnswer>(() => undefined);
    });
    const { rerender } = renderHook(
      ({ text }: { text: string }) => useInitialCheck({ text, validate }),
      { initialProps: { text: 'a' } },
    );

    rerender({ text: 'b' });

    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
  });

  it('aborts the check in flight when the view goes away', () => {
    const seen: AbortSignal[] = [];
    const validate = vi.fn((_request: CheckRequest, signal: AbortSignal) => {
      seen.push(signal);
      return new Promise<CheckAnswer>(() => undefined);
    });
    const { unmount } = renderHook(() =>
      useInitialCheck({ text: 'a', validate }),
    );

    unmount();

    expect(seen[0]?.aborted).toBe(true);
  });

  it('sets no state after the view goes away', async () => {
    let settle: (answer: CheckAnswer) => void = () => undefined;
    const validate = vi.fn(
      () =>
        new Promise<CheckAnswer>((resolve) => {
          settle = resolve;
        }),
    );
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderHook(() =>
      useInitialCheck({ text: 'a', validate }),
    );

    unmount();
    await act(async () => {
      settle(answerFor('a'));
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
