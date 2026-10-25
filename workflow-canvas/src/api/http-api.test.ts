// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
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
      view: DOCUMENT_BODY.view,
      diagnostics: [],
    });
  });

  it('reads a workflow with no file as no text and no view', async () => {
    const none = { ...DOCUMENT_BODY, text: null, hash: null, view: null };
    const { api } = apiFor(reply(none));

    expect(await api.getWorkflow('t')).toMatchObject({
      text: null,
      view: null,
    });
  });

  it('reads the message and line of each diagnostic', async () => {
    const body = {
      ...DOCUMENT_BODY,
      view: null,
      diagnostics: [
        { code: 'MISSING_KEY', message: 'Missing key', line: 3 },
        { code: 'WRONG_TYPE', message: 'Wrong type' },
      ],
    };
    const { api } = apiFor(reply(body));

    expect((await api.getWorkflow('t')).diagnostics).toEqual([
      { message: 'Missing key', line: 3 },
      { message: 'Wrong type', line: 0 },
    ]);
  });

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
});
