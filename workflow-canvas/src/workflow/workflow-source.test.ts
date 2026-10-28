// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import { HELLO_DOCUMENT, HELLO_SESSION } from '../test-support/fixtures';
import { createWorkflowSource } from './workflow-source';

function apiWith(createSession: WorkflowApi['createSession']): WorkflowApi {
  return {
    createSession,
    getWorkflow: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    startRun: vi.fn(),
    getRun: vi.fn(),
  };
}

const refused = () =>
  Promise.reject(new ApiError('The launch code is not valid.', 401));

describe('createWorkflowSource', () => {
  it('starts the first load once, whoever reads it', async () => {
    const createSession = vi.fn().mockResolvedValue(HELLO_SESSION);
    const source = createWorkflowSource(apiWith(createSession), 'first');

    await source.current();
    await source.current();

    expect(createSession).toHaveBeenCalledExactlyOnceWith('first');
  });

  it('changes to the workflow of a new code once its session is open', async () => {
    const createSession = vi.fn().mockResolvedValue(HELLO_SESSION);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    const before = source.current();
    const listener = vi.fn();
    source.subscribe(listener);

    await source.offer('second');

    expect(createSession).toHaveBeenLastCalledWith('second');
    expect(source.current()).not.toBe(before);
    expect(await source.current()).toMatchObject({ ok: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps the workflow on the page when the new code is refused', async () => {
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementationOnce(refused);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    const before = source.current();
    const listener = vi.fn();
    source.subscribe(listener);

    await source.offer('second');

    expect(source.current()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('shows the error of a new code when no workflow is on the page', async () => {
    const createSession = vi
      .fn()
      .mockImplementationOnce(refused)
      .mockImplementationOnce(refused);
    const source = createWorkflowSource(apiWith(createSession), 'first');

    await source.offer('second');

    expect(await source.current()).toEqual({
      ok: false,
      message: 'The launch code is not valid.',
    });
  });

  it('shows the workflow of a new code when the first load failed', async () => {
    const createSession = vi
      .fn()
      .mockImplementationOnce(refused)
      .mockResolvedValueOnce(HELLO_SESSION);
    const source = createWorkflowSource(apiWith(createSession), 'first');

    await source.offer('second');

    expect(await source.current()).toMatchObject({ ok: true });
  });

  it('lets the latest code win when two are offered one after the other', async () => {
    const answers: Array<(session: typeof HELLO_SESSION) => void> = [];
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );
    const source = createWorkflowSource(apiWith(createSession), 'first');
    const older = source.offer('second');
    const newer = source.offer('third');
    const listener = vi.fn();
    source.subscribe(listener);

    answers[1]!({ ...HELLO_SESSION, harness: 'newer' });
    await newer;
    answers[0]!({ ...HELLO_SESSION, harness: 'older' });
    await older;

    expect(listener).toHaveBeenCalledOnce();
    expect(await source.current()).toMatchObject({
      workflow: { harness: 'newer' },
    });
  });
});
