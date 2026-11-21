// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import type { WorkflowDocument } from '../api/types';
import { freshMemory } from '../test-support/memory-storage';
import { HELLO_DOCUMENT } from '../test-support/fixtures';
import { createWorkflowSource } from '../workflow/workflow-source';
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

/** A document of its own, so the tap tells one load from another. */
const documentOf = (name: string): WorkflowDocument => ({
  ...HELLO_DOCUMENT,
  view: { ...HELLO_DOCUMENT.view!, name },
});

describe('tapSessions', () => {
  it('has no token for a workflow it did not read', () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));

    expect(tap.tokenOf(HELLO_DOCUMENT)).toBeUndefined();
  });

  it('ties the token of a load to the workflow it loaded', async () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));

    const loaded = await tap.api.getWorkflow('token-1');

    expect(tap.tokenOf(loaded)).toBe('token-1');
  });

  it('gives the document through unchanged', async () => {
    const tap = tapSessions(apiThat(() => Promise.resolve(HELLO_DOCUMENT)));

    expect(await tap.api.getWorkflow('token-1')).toBe(HELLO_DOCUMENT);
  });

  it('ties no token to a load that failed', async () => {
    const first = documentOf('first');
    const getWorkflow = vi.fn((token: string) =>
      token === 'token-1'
        ? Promise.resolve(first)
        : Promise.reject(new ApiError('The code is spent.', 401)),
    );
    const tap = tapSessions(apiThat(getWorkflow));
    await tap.api.getWorkflow('token-1');

    await expect(tap.api.getWorkflow('token-2')).rejects.toThrow(ApiError);

    expect(tap.tokenOf(first)).toBe('token-1');
  });

  it('keeps the token of each workflow it read, whatever order they came in', async () => {
    const one = documentOf('one');
    const two = documentOf('two');
    const tap = tapSessions(
      apiThat((token: string) =>
        Promise.resolve(token === 'token-1' ? one : two),
      ),
    );

    await tap.api.getWorkflow('token-1');
    await tap.api.getWorkflow('token-2');

    expect(tap.tokenOf(one)).toBe('token-1');
    expect(tap.tokenOf(two)).toBe('token-2');
  });

  it('leaves every other call of the API as it is', () => {
    const api = apiThat(() => Promise.resolve(HELLO_DOCUMENT));

    const tap = tapSessions(api);

    expect(tap.api.startRun).toBe(api.startRun);
    expect(tap.api.saveWorkflow).toBe(api.saveWorkflow);
  });
});

describe('tapSessions and the workflow the page shows', () => {
  // Two offers in flight, the newer one answering first: the source shows the
  // newer workflow and ignores the older success that lands after it. The
  // token of the calls the views make must be the one of the workflow shown.
  function raceOf() {
    const older = documentOf('older');
    const newer = documentOf('newer');
    const held: { release: () => void } = { release: () => undefined };
    const waited = new Promise<void>((resolve) => {
      held.release = resolve;
    });
    const api = apiThat(async (token: string) => {
      if (token === 'token-older') {
        await waited;
        return older;
      }
      return newer;
    });
    const tap = tapSessions(api);
    return { tap, older, newer, held };
  }

  const sessionOf = (token: string) => ({
    token,
    root: '/workflows',
    harness: 'kiro-cli',
    apiVersion: 1,
  });

  it('gives the newer workflow its own token when an older load lands later', async () => {
    const { tap, older, newer, held } = raceOf();
    const memory = freshMemory();
    // Each offer trades its launch code for the session of that code.
    const createSession = vi.fn((code: string) =>
      Promise.resolve(sessionOf(`token-${code}`)),
    );
    const source = createWorkflowSource(
      { ...tap.api, createSession },
      undefined,
      memory,
    );

    const first = source.offer('older');
    const second = source.offer('newer');
    await second;
    held.release();
    await first;

    // The older load answered last, and the page still shows the newer
    // workflow, so the token of the calls must be the newer one.
    const shown = await source.current();
    expect(tap.tokenOf(older)).toBe('token-older');
    expect(shown.ok && shown.workflow.document).toBe(newer);
    expect(shown.ok && tap.tokenOf(shown.workflow.document)).toBe(
      'token-newer',
    );
  });
});
