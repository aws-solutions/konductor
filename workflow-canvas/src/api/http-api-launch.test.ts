// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { createHttpApi, LAUNCH_CODE_TIMEOUT_MS } from './http-api';

const SESSION_BODY = {
  token: 't-1',
  root: 'hello',
  harness: 'kiro-cli',
  api_version: 1,
};

function hangingFetch() {
  let aborted = false;
  let answer: (response: Response) => void = () => {};
  const fetchFn = vi.fn(
    (_path: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        answer = resolve;
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
  );
  return {
    fetchFn: fetchFn as unknown as typeof fetch,
    isAborted: () => aborted,
    answer: (body: unknown) => answer(new Response(JSON.stringify(body))),
  };
}

describe('the launch code trade', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not cut short at the ordinary timeout, and a late answer works', async () => {
    vi.useFakeTimers();
    const server = hangingFetch();
    const api = createHttpApi(server.fetchFn, 5000);

    const session = api.createSession('code-1');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.isAborted()).toBe(false);
    server.answer(SESSION_BODY);

    await expect(session).resolves.toMatchObject({ token: 't-1' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends at its own hard limit with a message that says the code may be spent', async () => {
    vi.useFakeTimers();
    const server = hangingFetch();
    const api = createHttpApi(server.fetchFn);

    const session = api.createSession('code-1');
    const outcome = expect(session).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('may have used it'),
    });
    await vi.advanceTimersByTimeAsync(LAUNCH_CODE_TIMEOUT_MS - 1);
    expect(server.isAborted()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await outcome;
    expect(server.isAborted()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends at once when the signal aborts, and says the person stopped', async () => {
    vi.useFakeTimers();
    const server = hangingFetch();
    const api = createHttpApi(server.fetchFn);
    const stop = new AbortController();

    const session = api.createSession('code-1', stop.signal);
    const outcome = expect(session).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('You stopped waiting'),
    });
    stop.abort();

    await outcome;
    expect(server.isAborted()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says the code may be spent when the connection drops', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('network')));
    const api = createHttpApi(fetchFn as unknown as typeof fetch);

    await expect(api.createSession('code-1')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('may have used it'),
    });
  });

  it('keeps the server sentence when the server refuses the code', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: 'The launch code is not valid.' }),
          {
            status: 401,
          },
        ),
      ),
    );
    const api = createHttpApi(fetchFn as unknown as typeof fetch);

    const failure = await api.createSession('code-1').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 401,
      message: 'The launch code is not valid.',
    });
  });

  it('leaves the ordinary calls at their own timeout', async () => {
    vi.useFakeTimers();
    const server = hangingFetch();
    const api = createHttpApi(server.fetchFn, 5000);

    const read = api.getRun('t', 'r');
    const outcome = expect(read).rejects.toMatchObject({
      status: 0,
      message: 'The server did not answer. Check that it is still running.',
    });
    await vi.advanceTimersByTimeAsync(5000);

    await outcome;
  });
});
