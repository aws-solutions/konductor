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
    [
      'two stages with one name',
      {
        ...DOCUMENT_BODY,
        view: {
          ...DOCUMENT_BODY.view,
          stages: [
            { name: 'd', agent: 'k-developer' },
            { name: 'd', agent: 'k-quality-assurance' },
          ],
        },
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
    ['a stage that `order` lists twice', run({ order: ['write', 'write'] })],
    ['an exit code that is a string', run({ exit_code: '1' })],
    ['an exit code that is not whole', run({ exit_code: 1.5 })],
    ['a run with no exit code', run({ exit_code: undefined })],
    ['a run id that is not in the pattern', run({ run_id: 'not-a-run-id' })],
    ['an empty run id', run({ run_id: '' })],
    ['a stage that `order` leaves out', run({ order: ['write'] })],
    [
      'a stage in `stages` that `order` does not list',
      run({
        order: [],
        stages: { ghost: { status: 'running' } },
      }),
    ],
    ['a running run with an exit code', run({ exit_code: 0 })],
    [
      'a passed run with a stage that is not passed',
      run({ status: 'passed', exit_code: 0 }),
    ],
    [
      'a passed run with a non-zero exit code',
      run({
        status: 'passed',
        exit_code: 1,
        stages: { write: { status: 'passed' }, review: { status: 'passed' } },
      }),
    ],
    [
      'a halted run with no stage blocked',
      run({ status: 'halted', exit_code: 1 }),
    ],
    [
      'a halted run with exit code 0',
      run({
        status: 'halted',
        exit_code: 0,
        stages: { write: { status: 'blocked' }, review: { status: 'pending' } },
      }),
    ],
    [
      'a halted run with two stages blocked',
      run({
        status: 'halted',
        exit_code: 1,
        stages: { write: { status: 'blocked' }, review: { status: 'blocked' } },
      }),
    ],
  ])('fails on %s', async (_, body) => {
    const { api } = apiFor(reply(body));

    await expect(api.getRun('t', 'r')).rejects.toBeInstanceOf(ApiError);
  });

  it('fails when the run is accepted with no id', async () => {
    const { api } = apiFor(reply({}, 202));

    await expect(api.startRun('t', 'g')).rejects.toBeInstanceOf(ApiError);
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'does not take the stage name %s for a stage the run lacks',
    async (name) => {
      const { api } = apiFor(
        reply(run({ order: [name], stages: { write: { status: 'passed' } } })),
      );

      await expect(api.getRun('t', 'r')).rejects.toBeInstanceOf(ApiError);
    },
  );

  it('adds the fix of an error body to its sentence', async () => {
    const { api } = apiFor(
      reply(
        {
          error: 'kiro-cli is not installed.',
          code: 'harness_unavailable',
          fix: 'Install kiro-cli and sign in, then try again.',
        },
        409,
      ),
    );

    await expect(api.startRun('t', 'g')).rejects.toMatchObject({
      message:
        'kiro-cli is not installed. Install kiro-cli and sign in, then try again.',
    });
  });

  it('says the run may have started when it is accepted with a reply it cannot read', async () => {
    const { api } = apiFor(new Response('ok', { status: 202 }));

    await expect(api.startRun('t', 'g')).rejects.toMatchObject({
      status: 202,
      message: expect.stringContaining('may have started'),
    });
  });

  it('says the run may have started when it is accepted with an empty id', async () => {
    const { api } = apiFor(reply({ run_id: '' }, 202));

    await expect(api.startRun('t', 'g')).rejects.toMatchObject({
      message: expect.stringContaining('may have started'),
    });
  });
});

describe('createHttpApi, when a call does not go through', () => {
  it('reports no answer, status 0, when the connection fails', async () => {
    const { api } = apiFor(new TypeError('fetch failed'));

    await expect(api.getRun('t', 'r')).rejects.toMatchObject({ status: 0 });
    await expect(api.startRun('t', 'g')).rejects.toMatchObject({ status: 0 });
  });

  it('reports the status of a server error whose body is not JSON', async () => {
    const { api } = apiFor(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    );

    await expect(api.getRun('t', 'r')).rejects.toMatchObject({
      status: 502,
      message: 'The server answered 502.',
    });
  });

  it('reports no answer when the body stops arriving, so the read can be tried again', async () => {
    const stream = new ReadableStream({
      start: (controller) => controller.error(new TypeError('terminated')),
    });
    const { api } = apiFor(new Response(stream, { status: 200 }));

    await expect(api.getRun('t', 'r')).rejects.toMatchObject({ status: 0 });
  });

  it('passes a signal to fetch, and aborts it when the caller aborts', async () => {
    let seen: AbortSignal | undefined;
    const fetchFn = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          seen?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const api = createHttpApi(fetchFn as unknown as typeof fetch);
    const caller = new AbortController();

    const call = api.getRun('t', 'r', caller.signal);
    expect(seen?.aborted).toBe(false);
    caller.abort();

    await expect(call).rejects.toMatchObject({ status: 0 });
    expect(seen?.aborted).toBe(true);
  });

  it('does not call at all when the caller has already aborted', async () => {
    let aborted = false;
    const fetchFn = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          aborted = init?.signal?.aborted ?? false;
          reject(new Error('aborted'));
        }),
    );
    const api = createHttpApi(fetchFn as unknown as typeof fetch);
    const caller = new AbortController();
    caller.abort();

    await expect(api.getRun('t', 'r', caller.signal)).rejects.toMatchObject({
      status: 0,
    });
    expect(aborted).toBe(true);
  });

  describe('with a server that never answers', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const hanging = () =>
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );

    it('gives up after the timeout and reports no answer', async () => {
      vi.useFakeTimers();
      const api = createHttpApi(hanging() as unknown as typeof fetch, 5000);

      const call = api.getRun('t', 'r');
      const outcome = expect(call).rejects.toMatchObject({ status: 0 });
      await vi.advanceTimersByTimeAsync(4999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      await outcome;
    });

    it('gives up when the body hangs after the headers came', async () => {
      vi.useFakeTimers();
      let hang: ReadableStreamDefaultController | undefined;
      const stream = new ReadableStream({ start: (c) => (hang = c) });
      const fetchFn = vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            const response = new Response(stream);
            init?.signal?.addEventListener('abort', () =>
              hang?.error(new Error('aborted')),
            );
            resolve(response);
          }),
      );
      const api = createHttpApi(fetchFn as unknown as typeof fetch, 5000);

      const call = api.getRun('t', 'r');
      const outcome = expect(call).rejects.toMatchObject({ status: 0 });
      await vi.advanceTimersByTimeAsync(5000);

      await outcome;
    });

    it('gives the launch code no timeout, as it works once', async () => {
      vi.useFakeTimers();
      let answer: (response: Response) => void = () => {};
      const fetchFn = vi.fn(
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      const api = createHttpApi(fetchFn as unknown as typeof fetch, 5000);
      let settled = false;

      const session = api.createSession('code-1').finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      answer(reply(SESSION_BODY));

      await expect(session).resolves.toMatchObject({ token: 't-1' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops its timer when the call ends', async () => {
      vi.useFakeTimers();
      const { api } = apiFor(reply(RUN_BODY));

      await api.getRun('t', 'r');

      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
