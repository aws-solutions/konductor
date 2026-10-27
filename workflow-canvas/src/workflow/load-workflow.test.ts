// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import {
  HELLO_DOCUMENT,
  HELLO_HASH,
  HELLO_SESSION,
  HELLO_VIEW,
  helloRun,
} from '../test-support/fixtures';
import { SaveConflict, SaveLost, SaveRefused } from '../designer/core';
import { RunAlreadyActive, RunReadRefused } from '../execution/core';
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

    const result = await loadWorkflow(api, 'code-1');

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

  it('ties the edit calls to the session token', async () => {
    const api = fakeApi();
    const result = await loadWorkflow(api, 'code-1');
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
    const result = await loadWorkflow(api, 'code-1');
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
    const result = await loadWorkflow(api, 'code-1');
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
    const result = await loadWorkflow(api, 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    const lost = result.workflow.edits.save('text', HELLO_HASH);

    await expect(lost).rejects.toBeInstanceOf(SaveLost);
    await expect(lost).rejects.toThrow('The server did not answer.');
  });

  it('tells a person what to do next in the message of a lost save', async () => {
    const failure = new ApiError('The server answered 502.', 502);
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    const lost = result.workflow.edits.save('text', HELLO_HASH);

    await expect(lost).rejects.toThrow(
      'The server answered 502. If it stopped, start it again and open the launch address that it printed.',
    );
  });

  it('lets any other failure of a save through as it is', async () => {
    const failure = new ApiError('Not allowed.', 403, 'read_only_workflow');
    const api = fakeApi({ saveWorkflow: vi.fn().mockRejectedValue(failure) });
    const result = await loadWorkflow(api, 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    const refused = result.workflow.edits.save('text', HELLO_HASH);

    await expect(refused).rejects.toBe(failure);
  });

  it('turns the 409 of an active run into the run to join, with its id', async () => {
    const api = fakeApi({
      startRun: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            'A run is already active.',
            409,
            'already_running',
            'active-1',
          ),
        ),
    });
    const result = await loadWorkflow(api, 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    const refused = result.workflow.runs.start('Ship it');

    await expect(refused).rejects.toBeInstanceOf(RunAlreadyActive);
    await expect(refused).rejects.toMatchObject({
      message: 'A run is already active.',
      runId: 'active-1',
    });
  });

  it.each([
    [
      'a 409 that is not an active run',
      new ApiError('kiro-cli is not installed.', 409, 'harness_unavailable'),
    ],
    [
      'an active run with no id',
      new ApiError('A run is already active.', 409, 'already_running'),
    ],
  ])('passes %s on as it is', async (_, error) => {
    const api = fakeApi({ startRun: vi.fn().mockRejectedValue(error) });
    const result = await loadWorkflow(api, 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    await expect(result.workflow.runs.start('Ship it')).rejects.toBe(error);
  });

  it.each([
    ['a 401', new ApiError('The session is not valid.', 401)],
    ['a 404', new ApiError('There is no such run.', 404)],
    ['a reply the page cannot read', new ApiError('Bad reply.', 200)],
  ])(
    'refuses a read that failed with %s, as reading again cannot help',
    async (_, error) => {
      const api = fakeApi({ getRun: vi.fn().mockRejectedValue(error) });
      const result = await loadWorkflow(api, 'code-1');
      if (!result.ok) throw new Error('The load failed.');

      const read = result.workflow.runs.get('r-1');

      await expect(read).rejects.toBeInstanceOf(RunReadRefused);
      await expect(read).rejects.toMatchObject({ message: error.message });
    },
  );

  it.each([
    ['no answer', new ApiError('The server did not answer.', 0)],
    ['a 503', new ApiError('The server answered 503.', 503)],
  ])(
    'passes a read that failed with %s on as it is, so it is tried again',
    async (_, error) => {
      const api = fakeApi({ getRun: vi.fn().mockRejectedValue(error) });
      const result = await loadWorkflow(api, 'code-1');
      if (!result.ok) throw new Error('The load failed.');

      await expect(result.workflow.runs.get('r-1')).rejects.toBe(error);
    },
  );

  it('fails without calling the API when there is no launch code', async () => {
    const api = fakeApi();

    const result = await loadWorkflow(api, undefined);

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

    expect(await loadWorkflow(api, 'bad')).toEqual({
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

    const result = await loadWorkflow(api, 'code-1');

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

    expect(await loadWorkflow(api, 'code-1')).toEqual({
      ok: false,
      message: 'Gone.',
    });
  });

  it('fails with a plain message for something that is not an Error', async () => {
    const api = fakeApi({
      getWorkflow: vi.fn().mockRejectedValue('boom'),
    });

    expect(await loadWorkflow(api, 'code-1')).toEqual({
      ok: false,
      message: 'The workflow did not load.',
    });
  });
});

describe('withDocument', () => {
  const document = { ...HELLO_DOCUMENT, hash: 'd'.repeat(64) };

  it('swaps the document of a loaded workflow and keeps the rest', async () => {
    const result = await loadWorkflow(fakeApi(), 'code-1');
    if (!result.ok) throw new Error('The load failed.');

    const swapped = withDocument(result, document);

    expect(swapped).toEqual({
      ok: true,
      workflow: { ...result.workflow, document },
    });
  });

  it('leaves a failed load and no load as they are', () => {
    const failed = { ok: false, message: 'No.' } as const;

    expect(withDocument(failed, document)).toBe(failed);
    expect(withDocument(undefined, document)).toBeUndefined();
  });
});
