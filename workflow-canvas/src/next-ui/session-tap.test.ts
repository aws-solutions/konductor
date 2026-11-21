// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import { HELLO_DOCUMENT } from '../test-support/fixtures';
import { tapSessions } from './session-tap';

function apiThat(getWorkflow: WorkflowApi['getWorkflow']): WorkflowApi {
  const no = () => Promise.reject(new Error('This test does not call it.'));
  return {
    createSession: no as unknown as WorkflowApi['createSession'],
    getWorkflow,
    saveWorkflow: no as unknown as WorkflowApi['saveWorkflow'],
    checkWorkflow: no as unknown as WorkflowApi['checkWorkflow'],
    startRun: no as unknown as WorkflowApi['startRun'],
    getRun: no as unknown as WorkflowApi['getRun'],
  };
}

describe('tapSessions', () => {
  it('has no token before a workflow has loaded', () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));

    expect(tap.loadedToken()).toBeUndefined();
  });

  it('records the token of the workflow that loaded', async () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));

    await tap.api.getWorkflow('token-1');

    expect(tap.loadedToken()).toBe('token-1');
  });

  it('gives the document through unchanged', async () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));

    expect(await tap.api.getWorkflow('token-1')).toBe(HELLO_DOCUMENT);
  });

  it('keeps the token of the workflow on the page when a later load fails', async () => {
    const getWorkflow = vi.fn((token: string) =>
      token === 'token-1'
        ? Promise.resolve(HELLO_DOCUMENT)
        : Promise.reject(new ApiError('The code is spent.', 401)),
    );
    const tap = tapSessions(apiThat(getWorkflow));
    await tap.api.getWorkflow('token-1');

    await expect(tap.api.getWorkflow('token-2')).rejects.toThrow(ApiError);

    expect(tap.loadedToken()).toBe('token-1');
  });

  it('moves to the token of the workflow that loaded after it', async () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));
    await tap.api.getWorkflow('token-1');

    await tap.api.getWorkflow('token-2');

    expect(tap.loadedToken()).toBe('token-2');
  });

  it('leaves every other call of the API as it is', () => {
    const api = apiThat(() => Promise.resolve(HELLO_DOCUMENT));

    const tap = tapSessions(api);

    expect(tap.api.startRun).toBe(api.startRun);
    expect(tap.api.saveWorkflow).toBe(api.saveWorkflow);
  });
});
