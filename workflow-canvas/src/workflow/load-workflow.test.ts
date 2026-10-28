// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import { sessionStorageMemory } from '../launch/session-memory';
import {
  HELLO_DOCUMENT,
  HELLO_HASH,
  HELLO_SESSION,
  HELLO_VIEW,
  helloRun,
} from '../test-support/fixtures';
import { freshMemory, memoryStorage } from '../test-support/memory-storage';
import { SaveConflict, SaveLost, SaveRefused } from '../designer/core';
import { loadWorkflow, withDocument } from './load-workflow';

const SAVED = { hash: 'b'.repeat(64), view: HELLO_VIEW, diagnostics: [] };

function fakeApi(overrides: Partial<WorkflowApi> = {}): WorkflowApi {
  return {
    createSession: vi.fn().mockResolvedValue(HELLO_SESSION),
    getWorkflow: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    saveWorkflow: vi.fn().mockResolvedValue(SAVED),
    checkWorkflow: vi
      .fn()
      .mockResolvedValue({ view: HELLO_VIEW, diagnostics: [] }),
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
        edits: {
          save: expect.any(Function),
          check: expect.any(Function),
          reload: expect.any(Function),
        },
        runs: { start: expect.any(Function), get: expect.any(Function) },
      },
      remember: expect.any(Function),
    });
  });

  it('ties the run calls to the session token', async () => {
    const api = fakeApi();
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const { signal } = new AbortController();
    const runId = await result.workflow.runs.start('Ship it', signal);
    await result.workflow.runs.get(runId, signal);

    expect(api.startRun).toHaveBeenCalledWith('token-1', 'Ship it', signal);
    expect(api.getRun).toHaveBeenCalledWith('token-1', runId, signal);
  });

  it('ties the edit calls to the session token', async () => {
    const api = fakeApi();
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');
    const { edits } = result.workflow;

    await edits.save('text', HELLO_HASH);
    await edits.check('text');
    await edits.reload();

    expect(api.saveWorkflow).toHaveBeenCalledWith(
      'token-1',
      'text',
      HELLO_HASH,
    );
    expect(api.checkWorkflow).toHaveBeenCalledWith('token-1', 'text');
    expect(api.getWorkflow).toHaveBeenCalledTimes(2);
    expect(api.getWorkflow).toHaveBeenLastCalledWith('token-1');
  });

  it('turns the 409 of a changed file into a conflict', async () => {
    const api = fakeApi({
      saveWorkflow: vi
        .fn()
        .mockRejectedValue(
          new ApiError('The file changed on disk.', 409, 'conflict'),
        ),
    });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const refused = result.workflow.edits.save('text', HELLO_HASH);

    await expect(refused).rejects.toBeInstanceOf(SaveConflict);
  });

  it('turns the 422 of a text with errors into a refusal with its findings', async () => {
    const findings = [
      { message: 'Unknown key.', line: 3, path: 'owner', severity: 'error' },
    ] as const;
    const api = fakeApi({
      saveWorkflow: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            'The workflow has errors.',
            422,
            'invalid_workflow',
            undefined,
            findings,
          ),
        ),
    });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const refused = await result.workflow.edits
      .save('text', HELLO_HASH)
      .catch((caught: unknown) => caught);

    expect(refused).toBeInstanceOf(SaveRefused);
    expect((refused as SaveRefused).diagnostics).toEqual(findings);
  });

  it.each([
    ['no answer', 0],
    ['a server error', 500],
  ])('turns %s to a save into a lost answer', async (_, status) => {
    const failure = new ApiError('The server did not answer.', status);
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const lost = result.workflow.edits.save('text', HELLO_HASH);

    await expect(lost).rejects.toBeInstanceOf(SaveLost);
    await expect(lost).rejects.toThrow('The server did not answer.');
  });

  it('turns a 200 whose body cannot be read, for a save, into a lost answer', async () => {
    const failure = new ApiError('Bad reply.', 200);
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const lost = result.workflow.edits.save('text', HELLO_HASH);

    await expect(lost).rejects.toBeInstanceOf(SaveLost);
  });

  it('warns that the draft is lost when the session is gone at a save', async () => {
    const failure = new ApiError(
      'The session is not valid.',
      401,
      'unauthorized',
    );
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const refused = result.workflow.edits.save('text', HELLO_HASH);

    await expect(refused).rejects.toThrow(
      'The session is not valid. Open the launch address that the server printed. The changes you made on this page are lost when you do; copy them first.',
    );
  });

  it('warns that the draft is lost for a 401 with no body of the API', async () => {
    const failure = new ApiError('The server answered 401.', 401);
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const refused = result.workflow.edits.save('text', HELLO_HASH);

    await expect(refused).rejects.toThrow(
      'The server answered 401. Open the launch address that the server printed. The changes you made on this page are lost when you do; copy them first.',
    );
  });

  it.each([
    ['the API', new ApiError('The session is not valid.', 401, 'unauthorized')],
    ['a proxy', new ApiError('The server answered 401.', 401)],
  ])(
    'tells the core that the session is lost at a check, as seen by %s',
    async (_, failure) => {
      const api = fakeApi({
        checkWorkflow: vi.fn().mockRejectedValue(failure),
      });
      const result = await loadWorkflow(api, 'code-1', freshMemory());
      if (!result.ok) throw new Error('The load failed.');

      const checked = result.workflow.edits.check('text');

      await expect(checked).rejects.toMatchObject({
        name: 'SessionLost',
        message: `${failure.message} Open the launch address that the server printed. The changes you made on this page are lost when you do; copy them first.`,
      });
    },
  );

  it('leaves another failure of a check as it is', async () => {
    const failure = new ApiError('Down.', 502);
    const api = fakeApi({ checkWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    await expect(result.workflow.edits.check('text')).rejects.toBe(failure);
  });

  it('gives the hash of the file in the conflict', async () => {
    const failure = new ApiError(
      'The file changed on disk.',
      409,
      'conflict',
      undefined,
      [],
      'c'.repeat(64),
    );
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const conflict = await result.workflow.edits
      .save('text', HELLO_HASH)
      .catch((caught: unknown) => caught);

    expect((conflict as SaveConflict).currentHash).toBe('c'.repeat(64));
  });

  it('tells a person what to do next in the message of a lost save', async () => {
    const failure = new ApiError('The server answered 502.', 502);
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const lost = result.workflow.edits.save('text', HELLO_HASH);

    await expect(lost).rejects.toThrow(
      'The server answered 502. If it stopped, start it again and open the launch address that it printed.',
    );
  });

  it('lets any other failure of a save through as it is', async () => {
    const failure = new ApiError('Not allowed.', 403, 'read_only_workflow');
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const refused = result.workflow.edits.save('text', HELLO_HASH);

    await expect(refused).rejects.toBe(failure);
  });

  describe('the run calls', () => {
    const { signal } = new AbortController();
    const portFor = async (api: WorkflowApi) => {
      const result = await loadWorkflow(api, 'code-1', freshMemory());
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
    expect(result).toEqual({
      ok: false,
      message:
        'Not reached. If it stopped, start it again and open the launch address that it printed.',
    });
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

describe('withDocument', () => {
  const document = { ...HELLO_DOCUMENT, hash: 'd'.repeat(64) };

  it('swaps the document of a loaded workflow and keeps the rest', async () => {
    const result = await loadWorkflow(fakeApi(), 'code-1', freshMemory());
    if (!result.ok) throw new Error('The load failed.');

    const swapped = withDocument(result, document);

    expect(swapped).toEqual({
      ok: true,
      workflow: { ...result.workflow, document },
      remember: result.remember,
    });
  });

  it('leaves a failed load and no load as they are', () => {
    const failed = { ok: false, message: 'No.' } as const;

    expect(withDocument(failed, document)).toBe(failed);
    expect(withDocument(undefined, document)).toBeUndefined();
  });
});
