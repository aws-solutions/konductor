// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import {
  HELLO_DOCUMENT,
  HELLO_SESSION,
  helloRun,
} from '../test-support/fixtures';
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

    const result = await loadWorkflow(api, 'code-1');

    expect(api.createSession).toHaveBeenCalledWith('code-1');
    expect(api.getWorkflow).toHaveBeenCalledWith('token-1');
    expect(result).toEqual({
      ok: true,
      workflow: {
        harness: 'kiro-cli',
        document: HELLO_DOCUMENT,
        runs: { start: expect.any(Function), get: expect.any(Function) },
      },
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
