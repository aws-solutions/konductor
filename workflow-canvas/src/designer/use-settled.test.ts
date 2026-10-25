// SPDX-License-Identifier: Apache-2.0
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSettled } from './use-settled';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useSettled', () => {
  it('is undefined until the promise settles, then its value', async () => {
    const { promise, resolve } = deferred<string>();
    const { result } = renderHook(() => useSettled(promise));
    expect(result.current).toBeUndefined();

    resolve('done');

    await waitFor(() => expect(result.current).toBe('done'));
  });

  it('goes back to undefined while a new promise is pending', async () => {
    const first = Promise.resolve('first');
    const next = deferred<string>();
    const { result, rerender } = renderHook(
      ({ promise }) => useSettled(promise),
      { initialProps: { promise: first } },
    );
    await waitFor(() => expect(result.current).toBe('first'));

    rerender({ promise: next.promise });
    expect(result.current).toBeUndefined();
    next.resolve('second');

    await waitFor(() => expect(result.current).toBe('second'));
  });

  it('ignores a promise that settles after the hook was unmounted', async () => {
    const { promise, resolve } = deferred<string>();
    const { result, unmount } = renderHook(() => useSettled(promise));

    unmount();
    resolve('late');
    await promise;

    expect(result.current).toBeUndefined();
  });
});
