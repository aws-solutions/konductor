// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { createHttpApi } from './http-api';

const SESSION_BODY = {
  token: 't-1',
  root: 'hello',
  harness: 'kiro-cli',
  api_version: 1,
  future_field: true,
};

const DOCUMENT_BODY = {
  name: 'hello',
  text: 'name: hello\n',
  hash: 'a'.repeat(64),
  read_only: false,
  view: {
    name: 'hello',
    intent: { outcome: 'Add a greeting' },
    stages: [{ name: 'draft', agent: 'k-developer' }],
  },
  diagnostics: [],
};

const RUN_STARTED_BODY = { run_id: '20261024-0412-a7b3c' };

const RUN_BODY = {
  run: {
    run_id: '20261024-0412-a7b3c',
    workflow: 'hello',
    harness: 'kiro-cli',
    status: 'running',
    started_at: '2026-10-24T04:12:05Z',
    finished_at: null,
    exit_code: null,
    order: ['write', 'review'],
    stages: { write: { status: 'passed' }, review: { status: 'running' } },
    future_field: true,
  },
};

// The run above with some fields replaced.
function run(changes: Record<string, unknown>) {
  return { run: { ...RUN_BODY.run, ...changes } };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function apiFor(response: Response | Error) {
  const fetchFn = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  return { fetchFn, api: createHttpApi(fetchFn as unknown as typeof fetch) };
}

describe('createHttpApi', () => {
  it('posts the launch code as JSON to /api/session', async () => {
    const { api, fetchFn } = apiFor(reply(SESSION_BODY));

    await api.createSession('code-1');

    const [path, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe('/api/session');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ code: 'code-1' });
  });

  it('reads the session and ignores fields it does not know', async () => {
    const { api } = apiFor(reply(SESSION_BODY));

    expect(await api.createSession('c')).toEqual({
      token: 't-1',
      root: 'hello',
      harness: 'kiro-cli',
      apiVersion: 1,
    });
  });

  it('gets /api/workflow with the bearer token', async () => {
    const { api, fetchFn } = apiFor(reply(DOCUMENT_BODY));

    await api.getWorkflow('t-1');

    const [path, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe('/api/workflow');
    expect(init.headers).toEqual({ Authorization: 'Bearer t-1' });
  });

  it('reads the workflow view', async () => {
    const { api } = apiFor(reply(DOCUMENT_BODY));

    expect(await api.getWorkflow('t')).toEqual({
      name: 'hello',
      text: 'name: hello\n',
      hash: 'a'.repeat(64),
      readOnly: false,
      view: DOCUMENT_BODY.view,
      diagnostics: [],
    });
  });

  it('reads a read-only workflow', async () => {
    const { api } = apiFor(reply({ ...DOCUMENT_BODY, read_only: true }));

    expect(await api.getWorkflow('t')).toMatchObject({ readOnly: true });
  });

  it('refuses a workflow that does not say whether it is read-only', async () => {
    const without: Record<string, unknown> = { ...DOCUMENT_BODY };
    delete without.read_only;
    const { api } = apiFor(reply(without));

    await expect(api.getWorkflow('t')).rejects.toBeInstanceOf(ApiError);
  });

  it('reads a workflow with no file as no text and no view', async () => {
    const none = { ...DOCUMENT_BODY, text: null, hash: null, view: null };
    const { api } = apiFor(reply(none));

    expect(await api.getWorkflow('t')).toMatchObject({
      text: null,
      hash: null,
      view: null,
    });
  });

  it('reads the message, line, path and severity of each diagnostic', async () => {
    const body = {
      ...DOCUMENT_BODY,
      view: null,
      diagnostics: [
        {
          code: 'MISSING_KEY',
          severity: 'error',
          path: 'stages.write',
          message: 'Missing key',
          line: 3,
        },
        {
          code: 'WRONG_TYPE',
          severity: 'warning',
          path: 'intent',
          message: 'Wrong type',
        },
      ],
    };
    const { api } = apiFor(reply(body));

    expect((await api.getWorkflow('t')).diagnostics).toEqual([
      {
        message: 'Missing key',
        line: 3,
        path: 'stages.write',
        severity: 'error',
      },
      {
        message: 'Wrong type',
        line: undefined,
        path: 'intent',
        severity: 'warning',
      },
    ]);
  });

  it('takes a severity it does not know as an error', async () => {
    const body = {
      ...DOCUMENT_BODY,
      view: null,
      diagnostics: [{ message: 'Odd', severity: 'fatal', path: '' }],
    };
    const { api } = apiFor(reply(body));

    expect((await api.getWorkflow('t')).diagnostics).toMatchObject([
      { severity: 'error' },
    ]);
  });

  it.each([0, -1, 2.5, '3', null])(
    'leaves out a line that is not a whole number from 1: %j',
    async (line) => {
      const body = {
        ...DOCUMENT_BODY,
        view: null,
        diagnostics: [{ code: 'X', message: 'Odd line', line }],
      };
      const { api } = apiFor(reply(body));

      expect((await api.getWorkflow('t')).diagnostics).toMatchObject([
        { message: 'Odd line', line: undefined },
      ]);
    },
  );

  it('fails with the sentence and code of an error body', async () => {
    const { api } = apiFor(
      reply(
        { error: 'The launch code is not valid.', code: 'invalid_code' },
        401,
      ),
    );

    await expect(api.createSession('x')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'The launch code is not valid.',
      status: 401,
      code: 'invalid_code',
    });
  });

  it('fails with the status when the error body is not an error body', async () => {
    const { api } = apiFor(new Response('<html>', { status: 502 }));

    await expect(api.getWorkflow('t')).rejects.toMatchObject({
      message: 'The server answered 502.',
      status: 502,
    });
  });

  it('fails with a plain message when the server does not answer', async () => {
    const { api } = apiFor(new TypeError('Failed to fetch'));

    const error = await api.getWorkflow('t').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0 });
    expect((error as ApiError).message).toContain('did not answer');
  });

  it.each([
    ['a body that is not an object', 'oops'],
    [
      'a session with no token',
      { root: 'hello', harness: 'kiro-cli', api_version: 1 },
    ],
    [
      'a session with no version',
      { token: 't', root: 'hello', harness: 'kiro-cli' },
    ],
  ])('fails on %s', async (_, body) => {
    const { api } = apiFor(reply(body));

    await expect(api.createSession('c')).rejects.toBeInstanceOf(ApiError);
  });

  it.each([
    [
      'a view with no intent',
      { ...DOCUMENT_BODY, view: { name: 'h', stages: [] } },
    ],
    ['diagnostics that are not a list', { ...DOCUMENT_BODY, diagnostics: {} }],
    [
      'a stage with no agent',
      {
        ...DOCUMENT_BODY,
        view: { ...DOCUMENT_BODY.view, stages: [{ name: 'd' }] },
      },
    ],
  ])('fails on a workflow with %s', async (_, body) => {
    const { api } = apiFor(reply(body));

    await expect(api.getWorkflow('t')).rejects.toBeInstanceOf(ApiError);
  });

  it('posts the goal as JSON to /api/run with the bearer token', async () => {
    const { api, fetchFn } = apiFor(reply(RUN_STARTED_BODY, 202));

    await api.startRun('t-1', 'Ship it');

    const [path, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe('/api/run');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer t-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      params: { goal: 'Ship it' },
    });
  });

  it('reads the id of the run that was accepted', async () => {
    const { api } = apiFor(reply(RUN_STARTED_BODY, 202));

    expect(await api.startRun('t', 'g')).toBe('20261024-0412-a7b3c');
  });

  it('fails with the sentence of a refused run, such as one already active', async () => {
    const { api } = apiFor(
      reply(
        {
          error: 'A run is already active.',
          code: 'already_running',
          run_id: '20261024-0412-a7b3c',
        },
        409,
      ),
    );

    await expect(api.startRun('t', 'g')).rejects.toMatchObject({
      message: 'A run is already active.',
      status: 409,
      code: 'already_running',
      runId: '20261024-0412-a7b3c',
    });
  });

  it('carries no run id when the error body has none', async () => {
    const { api } = apiFor(
      reply(
        { error: 'kiro-cli is not installed.', code: 'harness_unavailable' },
        409,
      ),
    );

    const error = await api
      .startRun('t', 'g')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).runId).toBeUndefined();
  });

  it('gets /api/runs/{id} with the bearer token', async () => {
    const { api, fetchFn } = apiFor(reply(RUN_BODY));

    await api.getRun('t-1', '20261024-0412-a7b3c');

    const [path, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe('/api/runs/20261024-0412-a7b3c');
    expect(init.headers).toEqual({ Authorization: 'Bearer t-1' });
  });

  it('encodes an id so it cannot change the path', async () => {
    const { api, fetchFn } = apiFor(reply(RUN_BODY));

    await api.getRun('t', '../workflow?x=1');

    const [path] = fetchFn.mock.calls[0] as unknown as [string];
    expect(path).toBe('/api/runs/..%2Fworkflow%3Fx%3D1');
  });

  it('reads a run that is running, with its stages in run order', async () => {
    const { api } = apiFor(reply(RUN_BODY));

    expect(await api.getRun('t', 'r')).toEqual({
      runId: '20261024-0412-a7b3c',
      status: 'running',
      exitCode: null,
      stages: [
        { name: 'write', status: 'passed' },
        { name: 'review', status: 'running' },
      ],
    });
  });

  it('reads a run that halted, with the stage that was blocked', async () => {
    const halted = {
      run: {
        ...RUN_BODY.run,
        status: 'halted',
        finished_at: '2026-10-24T04:12:49Z',
        exit_code: 1,
        stages: { write: { status: 'blocked' }, review: { status: 'pending' } },
      },
    };
    const { api } = apiFor(reply(halted));

    expect(await api.getRun('t', 'r')).toMatchObject({
      status: 'halted',
      exitCode: 1,
      stages: [
        { name: 'write', status: 'blocked' },
        { name: 'review', status: 'pending' },
      ],
    });
  });

  it('takes the order from `order`, not from the keys of `stages`', async () => {
    const swapped = {
      run: {
        ...RUN_BODY.run,
        order: ['review', 'write'],
        stages: RUN_BODY.run.stages,
      },
    };
    const { api } = apiFor(reply(swapped));

    expect((await api.getRun('t', 'r')).stages.map((s) => s.name)).toEqual([
      'review',
      'write',
    ]);
  });

  it('fails with the sentence of a run that is not there', async () => {
    const { api } = apiFor(
      reply({ error: 'There is no run with this id.', code: 'not_found' }, 404),
    );

    await expect(api.getRun('t', 'r')).rejects.toMatchObject({
      message: 'There is no run with this id.',
      status: 404,
    });
  });

  it.each([
    ['a body with no run', {}],
    ['a run with an unknown status', run({ status: 'paused' })],
    ['a run with no run id', run({ run_id: undefined })],
    ['an order that is not a list', run({ order: 'write' })],
    ['a stage in `order` that `stages` lacks', run({ order: ['nope'] })],
    [
      'a stage with an unknown status',
      run({ stages: { write: { status: 'skipped' }, review: {} } }),
    ],
    ['stages that are not an object', run({ stages: [] })],
  ])('fails on %s', async (_, body) => {
    const { api } = apiFor(reply(body));

    await expect(api.getRun('t', 'r')).rejects.toBeInstanceOf(ApiError);
  });

  it('fails when the run is accepted with no id', async () => {
    const { api } = apiFor(reply({}, 202));

    await expect(api.startRun('t', 'g')).rejects.toBeInstanceOf(ApiError);
  });

  describe('a call that does not end', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // A fetch that ends only when its signal aborts, as a hung one does.
    function hungFetch() {
      return vi.fn(
        (_path: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
    }

    it('passes a signal to every call', async () => {
      const { api, fetchFn } = apiFor(reply(RUN_BODY));

      await api.getRun('t', 'r');

      const [, init] = fetchFn.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('gives up after the timeout with the message of an unreachable server', async () => {
      vi.useFakeTimers();
      const fetchFn = hungFetch();
      const api = createHttpApi(fetchFn as unknown as typeof fetch, 5000);

      const outcome = api.getRun('t', 'r').catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchFn.mock.calls[0]?.[1].signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(await outcome).toMatchObject({
        status: 0,
        message: 'The server did not answer. Check that it is still running.',
      });
    });

    it('gives up on a body that does not arrive, as an unreachable server and not a bad reply', async () => {
      vi.useFakeTimers();
      // Headers arrive at once; the body ends only when the signal aborts.
      const fetchFn = vi.fn((_path: string, init: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal?.addEventListener('abort', () =>
              controller.error(new DOMException('Aborted', 'AbortError')),
            );
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      });
      const api = createHttpApi(fetchFn as unknown as typeof fetch, 5000);

      const outcome = api.getRun('t', 'r').catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(5000);

      expect(await outcome).toMatchObject({
        status: 0,
        message: 'The server did not answer. Check that it is still running.',
      });
    });

    it('stops the timer once the call has ended', async () => {
      vi.useFakeTimers();
      const { api } = apiFor(reply(RUN_BODY));

      await api.getRun('t', 'r');

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
