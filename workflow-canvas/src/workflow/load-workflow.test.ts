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
import { loadOnOpen, loadWorkflow } from './load-workflow';

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

    const { signal } = new AbortController();
    const runId = await result.workflow.runs.start('Ship it', signal);
    await result.workflow.runs.get(runId, signal);

    expect(api.startRun).toHaveBeenCalledWith('token-1', 'Ship it', signal);
    expect(api.getRun).toHaveBeenCalledWith('token-1', runId, signal);
  });

  describe('the run calls', () => {
    const { signal } = new AbortController();
    const portFor = async (api: WorkflowApi) => {
      const result = await loadWorkflow(api, 'code-1');
      if (!result.ok) throw new Error('The load failed.');
      return result.workflow.runs;
    };

    it('name the active run when the server answers 409 already_running with its id', async () => {
      const busy = new ApiError(
        'A run is already active.',
        409,
        'already_running',
        '20261024-0412-a7b3c',
      );
      const runs = await portFor(
        fakeApi({ startRun: vi.fn().mockRejectedValue(busy) }),
      );

      await expect(runs.start('g', signal)).rejects.toMatchObject({
        name: 'RunAlreadyActive',
        runId: '20261024-0412-a7b3c',
        message: 'A run is already active.',
      });
    });

    it.each([
      [
        'a 409 with another code',
        new ApiError('Busy.', 409, 'harness_unavailable', 'r1'),
      ],
      ['a 409 with no run id', new ApiError('Busy.', 409, 'already_running')],
      ['a 500', new ApiError('Broken.', 500)],
    ])('leave %s as the error it is', async (_, error) => {
      const runs = await portFor(
        fakeApi({ startRun: vi.fn().mockRejectedValue(error) }),
      );

      await expect(runs.start('g', signal)).rejects.toBe(error);
    });

    it.each([
      ['no answer', new ApiError('No answer.', 0)],
      ['an accepted run in an unreadable reply', new ApiError('Odd.', 202)],
    ])('tell that the run may have started after %s', async (_, error) => {
      const runs = await portFor(
        fakeApi({ startRun: vi.fn().mockRejectedValue(error) }),
      );

      await expect(runs.start('g', signal)).rejects.toMatchObject({
        name: 'RunStartUnsure',
        message: error.message,
      });
    });

    it.each([
      ['a 401', new ApiError('No session.', 401)],
      ['a 404', new ApiError('No such run.', 404)],
      ['a reply the page cannot read', new ApiError('Bad reply.', 200)],
    ])('refuse to read again after %s', async (_, error) => {
      const runs = await portFor(
        fakeApi({ getRun: vi.fn().mockRejectedValue(error) }),
      );

      await expect(runs.get('r', signal)).rejects.toMatchObject({
        name: 'RunReadRefused',
        message: error.message,
      });
    });

    it.each([
      ['no answer', new ApiError('No answer.', 0)],
      ['a 502', new ApiError('Bad gateway.', 502)],
      ['a 429', new ApiError('Slow down.', 429)],
      ['an error that is not an ApiError', new Error('Odd.')],
    ])('leave %s open to another try', async (_, error) => {
      const runs = await portFor(
        fakeApi({ getRun: vi.fn().mockRejectedValue(error) }),
      );

      await expect(runs.get('r', signal)).rejects.toBe(error);
    });
  });

  it('fails without calling the API when there is no launch code', async () => {
    const api = fakeApi();

    const result = await loadWorkflow(api, undefined, freshMemory());

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.message).toContain('launch code');
    expect(result.ok === false && result.message).toContain('works once');
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
  it('keeps the earlier session until the page shows the workflow', async () => {
    const { memory } = memoryWith(STORED);

    await loadWorkflow(fakeApi(), 'code-1', memory);

    expect(memory.recall()).toEqual(STORED);
  });

  it('keeps the session at once when none is kept, so a failed load does not lose it', async () => {
    const api = fakeApi({
      getWorkflow: vi
        .fn()
        .mockRejectedValue(new ApiError('Server error.', 500)),
    });
    const { memory } = memoryWith();

    const result = await loadWorkflow(api, 'code-1', memory);

    expect(result).toMatchObject({ ok: false });
    expect(memory.recall()).toEqual({ token: 'token-1', harness: 'kiro-cli' });
  });

  it('does not replace the kept session when the load of a new code fails', async () => {
    const api = fakeApi({
      getWorkflow: vi
        .fn()
        .mockRejectedValue(new ApiError('Server error.', 500)),
    });
    const { memory } = memoryWith(STORED);

    await loadWorkflow(api, 'code-1', memory);

    expect(memory.recall()).toEqual(STORED);
  });

  it('keeps nothing when the server speaks another API version', async () => {
    const api = fakeApi({
      createSession: vi
        .fn()
        .mockResolvedValue({ ...HELLO_SESSION, apiVersion: 2 }),
    });
    const { memory } = memoryWith();

    await loadWorkflow(api, 'code-1', memory);

    expect(memory.recall()).toBeUndefined();
  });

  it('forgets the session when the load that follows the code answers 401', async () => {
    const api = fakeApi({
      getWorkflow: vi.fn().mockRejectedValue(new ApiError('Wrong.', 401)),
    });
    const { memory } = memoryWith();

    const result = await loadWorkflow(api, 'code-1', memory);

    expect(memory.recall()).toBeUndefined();
    expect(result.ok === false && result.message).toMatch(
      /server no longer knows this session.*An address works once\./s,
    );
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
    memory.remember({ token: 'newer-token', harness: STORED.harness });

    refuse();
    await loading;

    expect(memory.recall()).toEqual({
      token: 'newer-token',
      harness: STORED.harness,
    });
  });
});

describe('loadOnOpen', () => {
  const refusedCode = () =>
    vi
      .fn()
      .mockRejectedValue(new ApiError('The launch code is not valid.', 401));

  it('resumes the kept session when the code in the address is spent', async () => {
    const api = fakeApi({ createSession: refusedCode() });
    const { memory } = memoryWith(STORED);

    const result = await loadOnOpen(api, 'spent', memory);

    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'stored-harness' },
    });
    expect(api.getWorkflow).toHaveBeenCalledWith('stored-token');
    expect(memory.recall()).toEqual(STORED);
  });

  it('tells why the code was not opened when it resumes the kept session', async () => {
    const api = fakeApi({ createSession: refusedCode() });

    const result = await loadOnOpen(api, 'spent', memoryWith(STORED).memory);

    expect(result).toMatchObject({
      ok: true,
      refused: 'The launch code is not valid.',
    });
  });

  it('tells nothing when the code opens the workflow', async () => {
    const result = await loadOnOpen(
      fakeApi(),
      'code-1',
      memoryWith(STORED).memory,
    );

    expect(result).not.toHaveProperty('refused');
  });

  it('shows the error of the code when the kept session fails too', async () => {
    const api = fakeApi({
      createSession: refusedCode(),
      getWorkflow: vi.fn().mockRejectedValue(new ApiError('Wrong.', 401)),
    });
    const { memory } = memoryWith(STORED);

    const result = await loadOnOpen(api, 'spent', memory);

    expect(result).toEqual({
      ok: false,
      message: 'The launch code is not valid.',
    });
    expect(memory.recall()).toBeUndefined();
  });

  it('shows the error of the code when no session is kept', async () => {
    const result = await loadOnOpen(
      fakeApi({ createSession: refusedCode() }),
      'spent',
      memoryWith().memory,
    );

    expect(result).toEqual({
      ok: false,
      message: 'The launch code is not valid.',
    });
  });

  it('does not touch the kept session when the code works', async () => {
    const api = fakeApi();
    const { memory } = memoryWith(STORED);

    await loadOnOpen(api, 'code-1', memory);

    expect(api.getWorkflow).toHaveBeenCalledExactlyOnceWith('token-1');
  });

  it('keeps the session of the code when its first load fails and the kept session is dead', async () => {
    const api = fakeApi({
      getWorkflow: vi.fn((token: string) =>
        Promise.reject(
          token === 'stored-token'
            ? new ApiError('Wrong.', 401)
            : new ApiError('Server error.', 500),
        ),
      ),
    });
    const { memory } = memoryWith(STORED);

    const result = await loadOnOpen(api, 'code-1', memory);

    expect(result).toMatchObject({ ok: false });
    expect(memory.recall()).toEqual({ token: 'token-1', harness: 'kiro-cli' });
  });

  it('resumes the kept session when there is no code', async () => {
    const api = fakeApi();

    await loadOnOpen(api, undefined, memoryWith(STORED).memory);

    expect(api.getWorkflow).toHaveBeenCalledWith('stored-token');
  });
});

const PASTED = { token: 'token-1', harness: 'kiro-cli' };
const PENDING = { token: 'pending-token', harness: 'pending-harness' };

const serverError = () => new ApiError('Server error.', 500);
const unknownSession = () => new ApiError('Wrong.', 401);

function apiByToken(failures: Record<string, ApiError>): WorkflowApi {
  return fakeApi({
    getWorkflow: vi.fn((token: string) =>
      failures[token]
        ? Promise.reject(failures[token])
        : Promise.resolve(HELLO_DOCUMENT),
    ),
  });
}

function memoryWithPending(kept?: typeof STORED) {
  const { memory } = memoryWith(kept);
  memory.holdPending(PENDING);
  return memory;
}

describe('loadWorkflow with a pasted code over a kept session', () => {
  it('holds the session of the code as pending at once, so a failed load does not lose it', async () => {
    const { memory } = memoryWith(STORED);

    const result = await loadWorkflow(
      apiByToken({ 'token-1': serverError() }),
      'code-1',
      memory,
    );

    expect(result).toMatchObject({ ok: false });
    expect(memory.recall()).toEqual(STORED);
    expect(memory.recallPending()).toEqual(PASTED);
  });

  it('holds nothing when the code is refused', async () => {
    const api = fakeApi({
      createSession: vi.fn().mockRejectedValue(unknownSession()),
    });
    const { memory } = memoryWith(STORED);

    await loadWorkflow(api, 'spent', memory);

    expect(memory.recallPending()).toBeUndefined();
  });

  it('keeps the session and holds nothing once told to', async () => {
    const { memory } = memoryWith(STORED);
    const result = await loadWorkflow(fakeApi(), 'code-1', memory);
    if (!result.ok) throw new Error('The load failed.');

    result.remember();

    expect(memory.recall()).toEqual(PASTED);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('holds the newest of two failed pastes as pending and keeps the shown session', async () => {
    const memory = memoryWithPending(STORED);

    const result = await loadWorkflow(
      apiByToken({ 'token-1': serverError() }),
      'code-2',
      memory,
    );

    expect(result).toMatchObject({ ok: false });
    expect(memory.recall()).toEqual(STORED);
    expect(memory.recallPending()).toEqual(PASTED);
  });

  it('drops the pending session when its load answers 401', async () => {
    const { memory } = memoryWith(STORED);

    await loadWorkflow(
      apiByToken({ 'token-1': unknownSession() }),
      'code-1',
      memory,
    );

    expect(memory.recallPending()).toBeUndefined();
    expect(memory.recall()).toEqual(STORED);
  });
});

describe('loadWorkflow with a pending session', () => {
  it('opens the pending session before the kept one', async () => {
    const api = fakeApi();

    const result = await loadWorkflow(
      api,
      undefined,
      memoryWithPending(STORED),
    );

    expect(api.getWorkflow).toHaveBeenCalledExactlyOnceWith('pending-token');
    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'pending-harness' },
    });
    expect(result).not.toHaveProperty('refused');
  });

  it('keeps it in place of the kept session once told to', async () => {
    const memory = memoryWithPending(STORED);
    const result = await loadWorkflow(fakeApi(), undefined, memory);
    if (!result.ok) throw new Error('The load failed.');

    result.remember();

    expect(memory.recall()).toEqual(PENDING);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('opens it when no session is kept', async () => {
    const result = await loadWorkflow(
      fakeApi(),
      undefined,
      memoryWithPending(),
    );

    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'pending-harness' },
    });
  });

  it('opens the kept session and tells why when the server refuses the pending one', async () => {
    const memory = memoryWithPending(STORED);

    const result = await loadWorkflow(
      apiByToken({ 'pending-token': unknownSession() }),
      undefined,
      memory,
    );

    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'stored-harness' },
    });
    expect(result).not.toHaveProperty('refused');
    expect(memory.recallPending()).toBeUndefined();
  });

  it('opens the kept session when the pending one fails to load, and holds the pending one', async () => {
    const memory = memoryWithPending(STORED);

    const result = await loadWorkflow(
      apiByToken({ 'pending-token': serverError() }),
      undefined,
      memory,
    );

    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'stored-harness' },
    });
    expect(result).not.toHaveProperty('refused');
    expect(memory.recallPending()).toEqual(PENDING);
  });

  it('holds the pending session after the kept one is shown in its place', async () => {
    const memory = memoryWithPending(STORED);
    const result = await loadWorkflow(
      apiByToken({ 'pending-token': serverError() }),
      undefined,
      memory,
    );
    if (!result.ok) throw new Error('The load failed.');

    result.remember();

    expect(memory.recall()).toEqual(STORED);
    expect(memory.recallPending()).toEqual(PENDING);
  });

  it('keeps the kept session when only the pending one is refused, though both have one harness', async () => {
    const { memory } = memoryWith(STORED);
    memory.holdPending({ token: 'pending-token', harness: STORED.harness });

    await loadWorkflow(
      apiByToken({ 'pending-token': unknownSession() }),
      undefined,
      memory,
    );

    expect(memory.recall()).toEqual(STORED);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('holds the pending session when only the kept one is refused, though both have one harness', async () => {
    const { memory } = memoryWith(STORED);
    const pending = { token: 'pending-token', harness: STORED.harness };
    memory.holdPending(pending);

    const result = await loadWorkflow(
      apiByToken({
        'pending-token': serverError(),
        'stored-token': unknownSession(),
      }),
      undefined,
      memory,
    );

    expect(result).toEqual({ ok: false, message: 'Server error.' });
    expect(memory.recall()).toBeUndefined();
    expect(memory.recallPending()).toEqual(pending);
  });

  it('shows the error of the pending session when the kept one fails too, and holds the pending one', async () => {
    const memory = memoryWithPending(STORED);

    const result = await loadWorkflow(
      apiByToken({
        'pending-token': serverError(),
        'stored-token': unknownSession(),
      }),
      undefined,
      memory,
    );

    expect(result).toEqual({ ok: false, message: 'Server error.' });
    expect(memory.recall()).toBeUndefined();
    expect(memory.recallPending()).toEqual(PENDING);
  });
});

describe('loadOnOpen after a pasted code whose first load failed', () => {
  it('resumes the pasted session on a reload, though the kept session is dead', async () => {
    const { memory } = memoryWith(STORED);
    const api = fakeApi({
      getWorkflow: vi
        .fn()
        .mockRejectedValueOnce(serverError())
        .mockResolvedValue(HELLO_DOCUMENT),
    });
    await loadWorkflow(api, 'code-1', memory);
    vi.mocked(api.getWorkflow).mockImplementation((token) =>
      token === 'stored-token'
        ? Promise.reject(unknownSession())
        : Promise.resolve(HELLO_DOCUMENT),
    );

    const result = await loadOnOpen(api, undefined, memory);

    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'kiro-cli' },
    });
    expect(api.getWorkflow).toHaveBeenLastCalledWith('token-1');
  });
});

describe('loadOnOpen sessions', () => {
  it('resumes the session kept when the open began, not the one the open just made', async () => {
    const api = apiByToken({ 'token-1': serverError() });
    const { memory } = memoryWith(STORED);

    const result = await loadOnOpen(api, 'code-1', memory);

    expect(vi.mocked(api.getWorkflow).mock.calls).toEqual([
      ['token-1'],
      ['stored-token'],
    ]);
    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'stored-harness' },
      refused: 'Server error.',
    });
    if (!result.ok) throw new Error('The load failed.');
    result.remember();
    expect(memory.recall()).toEqual(STORED);
  });

  it('drops a pending session when the session of the address is kept', async () => {
    const memory = memoryWithPending(STORED);

    await loadOnOpen(fakeApi(), 'code-1', memory);

    expect(memory.recall()).toEqual(PASTED);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('opens the pending session when the code of the address is refused', async () => {
    const api = fakeApi({
      createSession: vi.fn().mockRejectedValue(unknownSession()),
    });

    const result = await loadOnOpen(api, 'spent', memoryWithPending(STORED));

    expect(result).toMatchObject({
      ok: true,
      workflow: { harness: 'pending-harness' },
      refused: 'Wrong.',
    });
  });

  it('does not overwrite a newer session that has the same harness, nor hold the session of the address', async () => {
    let open!: () => void;
    const api = fakeApi({
      createSession: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            open = () => resolve({ ...HELLO_SESSION, harness: STORED.harness });
          }),
      ),
    });
    const { memory } = memoryWith(STORED);
    const loading = loadOnOpen(api, 'code-1', memory);
    const newer = { token: 'newer-token', harness: STORED.harness };
    memory.remember(newer);

    open();
    await loading;

    expect(memory.recall()).toEqual(newer);
    expect(memory.recallPending()).toBeUndefined();
  });
});

function slowSession() {
  let answer!: (harness: string) => void;
  const api = fakeApi({
    createSession: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = (harness) => resolve({ ...HELLO_SESSION, harness });
        }),
    ),
  });
  return { api, answer: (harness: string) => answer(harness) };
}

describe('a session that answers after a newer one was kept', () => {
  const newer = { token: 'newer-token', harness: 'kiro-cli' };

  it('is not held as pending when a paste over a kept session answers late', async () => {
    const { api, answer } = slowSession();
    const { memory } = memoryWith(STORED);
    const loading = loadWorkflow(api, 'slow', memory);
    memory.remember(newer);

    answer('kiro-cli');
    await loading;

    expect(memory.recall()).toEqual(newer);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('does not replace a pending session that a newer paste held meanwhile', async () => {
    const { api, answer } = slowSession();
    const { memory } = memoryWith(STORED);
    const loading = loadWorkflow(api, 'slow', memory);
    memory.remember(newer);
    memory.holdPending(PENDING);

    answer('kiro-cli');
    await loading;

    expect(memory.recall()).toEqual(newer);
    expect(memory.recallPending()).toEqual(PENDING);
  });

  it('is not held or kept when a paste with nothing kept answers late', async () => {
    const { api, answer } = slowSession();
    const { memory } = memoryWith();
    const loading = loadWorkflow(api, 'slow', memory);
    memory.remember(newer);

    answer('kiro-cli');
    await loading;

    expect(memory.recall()).toEqual(newer);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('is not held as pending when an open with nothing kept answers late', async () => {
    const { api, answer } = slowSession();
    const { memory } = memoryWith();
    const loading = loadOnOpen(api, 'slow', memory);
    memory.remember(newer);

    answer('kiro-cli');
    await loading;

    expect(memory.recall()).toEqual(newer);
    expect(memory.recallPending()).toBeUndefined();
  });

  it('is still held as pending when nothing was kept meanwhile', async () => {
    const { api, answer } = slowSession();
    const { memory } = memoryWith(STORED);
    const loading = loadWorkflow(api, 'slow', memory);

    answer('kiro-cli');
    await loading;

    expect(memory.recall()).toEqual(STORED);
    expect(memory.recallPending()).toEqual(PASTED);
  });
});
