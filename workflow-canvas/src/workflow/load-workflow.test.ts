// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import { sessionStorageMemory } from '../launch/session-memory';
import {
  HELLO_DOCUMENT,
  HELLO_SESSION,
  helloRun,
} from '../test-support/fixtures';
import { freshMemory, memoryStorage } from '../test-support/memory-storage';
import { loadWorkflow } from './load-workflow';

function fakeApi(overrides: Partial<WorkflowApi> = {}): WorkflowApi {
  return {
    createSession: vi.fn().mockResolvedValue(HELLO_SESSION),
    getWorkflow: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    startRun: vi.fn().mockResolvedValue('20261024-0412-a7b3c'),
    getRun: vi.fn().mockResolvedValue(helloRun(0)),
    ...overrides,
  };
}

describe('loadWorkflow', () => {
  it('opens a session with the code, then loads with its token', async () => {
    const api = fakeApi();

    const result = await loadWorkflow(api, 'code-1', freshMemory());

    expect(api.createSession).toHaveBeenCalledWith('code-1');
    expect(api.getWorkflow).toHaveBeenCalledWith('token-1');
    expect(result).toEqual({
      ok: true,
      workflow: {
        harness: 'kiro-cli',
        document: HELLO_DOCUMENT,
        runs: { start: expect.any(Function), get: expect.any(Function) },
      },
      remember: expect.any(Function),
    });
  });

  it('ties the run calls to the session token', async () => {
    const api = fakeApi();
    const result = await loadWorkflow(api, 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    const runId = await result.workflow.runs.start('Ship it');
    await result.workflow.runs.get(runId);

    expect(api.startRun).toHaveBeenCalledWith('token-1', 'Ship it');
    expect(api.getRun).toHaveBeenCalledWith('token-1', runId);
  });

  it('fails without calling the API when there is no launch code', async () => {
    const api = fakeApi();

    const result = await loadWorkflow(api, undefined, freshMemory());

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toContain('launch code');
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('fails with the message of a refused session', async () => {
    const api = fakeApi({
      createSession: vi
        .fn()
        .mockRejectedValue(new ApiError('The launch code is not valid.', 401)),
    });

    expect(await loadWorkflow(api, 'bad', freshMemory())).toEqual({
      ok: false,
      message: 'The launch code is not valid.',
    });
    expect(api.getWorkflow).not.toHaveBeenCalled();
  });

  it('fails without loading when the server speaks another API version', async () => {
    const api = fakeApi({
      createSession: vi
        .fn()
        .mockResolvedValue({ ...HELLO_SESSION, apiVersion: 2 }),
    });

    const result = await loadWorkflow(api, 'code-1', freshMemory());

    expect(result).toEqual({
      ok: false,
      message:
        'The server speaks a version of the API that this page does not understand.',
    });
    expect(api.getWorkflow).not.toHaveBeenCalled();
  });

  it('fails with the message of a refused load', async () => {
    const api = fakeApi({
      getWorkflow: vi.fn().mockRejectedValue(new ApiError('Gone.', 404)),
    });

    expect(await loadWorkflow(api, 'code-1', freshMemory())).toEqual({
      ok: false,
      message: 'Gone.',
    });
  });

  it('fails with a plain message for something that is not an Error', async () => {
    const api = fakeApi({
      getWorkflow: vi.fn().mockRejectedValue('boom'),
    });

    expect(await loadWorkflow(api, 'code-1', freshMemory())).toEqual({
      ok: false,
      message: 'The workflow did not load.',
    });
  });
});

const STORED = { token: 'stored-token', harness: 'stored-harness' };

function memoryWith(record?: typeof STORED) {
  const sessionStorage = memoryStorage();
  const memory = sessionStorageMemory({ sessionStorage });
  if (record) memory.remember(record);
  return { memory, sessionStorage };
}

describe('loadWorkflow with a launch code', () => {
  it('keeps nothing until the page shows the workflow', async () => {
    const { memory } = memoryWith();

    await loadWorkflow(fakeApi(), 'code-1', memory);

    expect(memory.recall()).toBeUndefined();
  });

  it('keeps the token and the harness of the session once told to', async () => {
    const { memory } = memoryWith();
    const result = await loadWorkflow(fakeApi(), 'code-1', memory);
    if (!result.ok) throw new Error('The load failed.');

    result.remember();

    expect(memory.recall()).toEqual({
      token: 'token-1',
      harness: 'kiro-cli',
    });
  });

  it('never writes the launch code to the storage', async () => {
    const { memory, sessionStorage } = memoryWith();
    const result = await loadWorkflow(fakeApi(), 'code-1', memory);
    if (!result.ok) throw new Error('The load failed.');

    result.remember();

    expect([...sessionStorage.entries.values()].join('')).not.toContain(
      'code-1',
    );
  });

  it('uses the code, not the kept session, when the address has one', async () => {
    const api = fakeApi();
    const { memory } = memoryWith(STORED);

    await loadWorkflow(api, 'code-1', memory);

    expect(api.createSession).toHaveBeenCalledWith('code-1');
    expect(api.getWorkflow).toHaveBeenCalledOnce();
    expect(api.getWorkflow).toHaveBeenCalledWith('token-1');
  });

  it('leaves the kept session alone when the code is refused', async () => {
    const api = fakeApi({
      createSession: vi
        .fn()
        .mockRejectedValue(new ApiError('The launch code is not valid.', 401)),
    });
    const { memory } = memoryWith(STORED);

    await loadWorkflow(api, 'used-already', memory);

    expect(memory.recall()).toEqual(STORED);
  });
});

describe('loadWorkflow with a kept session', () => {
  it('loads the workflow with the kept token, and asks for no session', async () => {
    const api = fakeApi();
    const { memory } = memoryWith(STORED);

    const result = await loadWorkflow(api, undefined, memory);

    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.getWorkflow).toHaveBeenCalledWith('stored-token');
    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'stored-harness', document: HELLO_DOCUMENT },
    });
  });

  it('forgets a token that the server answers 401 to, and says what to do', async () => {
    const api = fakeApi({
      getWorkflow: vi
        .fn()
        .mockRejectedValue(
          new ApiError('The session token is missing or wrong.', 401),
        ),
    });
    const { memory } = memoryWith(STORED);

    const result = await loadWorkflow(api, undefined, memory);

    expect(memory.recall()).toBeUndefined();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toMatch(
      /server no longer knows this session.*launch address/s,
    );
  });

  it('keeps the token when the server does not answer', async () => {
    const api = fakeApi({
      getWorkflow: vi.fn().mockRejectedValue(new ApiError('Not reached.', 0)),
    });
    const { memory } = memoryWith(STORED);

    const result = await loadWorkflow(api, undefined, memory);

    expect(memory.recall()).toEqual(STORED);
    expect(result).toEqual({ ok: false, message: 'Not reached.' });
  });

  it('does not forget a newer session when an older token is refused late', async () => {
    let refuse!: () => void;
    const api = fakeApi({
      getWorkflow: vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            refuse = () => reject(new ApiError('Wrong.', 401));
          }),
      ),
    });
    const { memory } = memoryWith(STORED);
    const loading = loadWorkflow(api, undefined, memory);
    memory.remember({ token: 'newer-token', harness: 'kiro-cli' });

    refuse();
    await loading;

    expect(memory.recall()).toEqual({
      token: 'newer-token',
      harness: 'kiro-cli',
    });
  });
});
