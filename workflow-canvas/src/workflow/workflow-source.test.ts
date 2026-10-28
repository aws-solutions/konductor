// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import { HELLO_DOCUMENT, HELLO_SESSION } from '../test-support/fixtures';
import { createWorkflowSource } from './workflow-source';

function apiWith(createSession: WorkflowApi['createSession']): WorkflowApi {
  return {
    createSession,
    getWorkflow: vi.fn().mockResolvedValue(HELLO_DOCUMENT),
  };
}

/** Lets every promise that can already settle do so. */
async function settleMicrotasks() {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
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

  it('keeps a workflow that was offered earlier when a later code is refused', async () => {
    const answers: Array<(session: typeof HELLO_SESSION) => void> = [];
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementationOnce(
        () => new Promise((resolve) => answers.push(resolve)),
      )
      .mockImplementationOnce(refused);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    await source.current();
    const older = source.offer('second');
    const newer = source.offer('third');

    await newer;
    answers[0]!({ ...HELLO_SESSION, harness: 'older' });
    await older;

    expect(await source.current()).toMatchObject({
      workflow: { harness: 'older' },
    });
  });

  it('shows a workflow that arrives after a newer code was refused', async () => {
    const answers: Array<(session: typeof HELLO_SESSION) => void> = [];
    const createSession = vi
      .fn()
      .mockImplementationOnce(refused)
      .mockImplementationOnce(
        () => new Promise((resolve) => answers.push(resolve)),
      )
      .mockImplementationOnce(refused);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    const older = source.offer('second');
    await source.offer('third');

    answers[0]!(HELLO_SESSION);
    await older;

    expect(await source.current()).toMatchObject({ ok: true });
  });

  it('does not let a late error replace a workflow shown meanwhile', async () => {
    let failFirstLoad!: () => void;
    const createSession = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failFirstLoad = () => reject(new ApiError('Too late.', 503));
          }),
      )
      .mockImplementationOnce(refused)
      .mockResolvedValueOnce(HELLO_SESSION);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    const refusedOffer = source.offer('second');
    await settleMicrotasks();
    await source.offer('third');

    failFirstLoad();
    await refusedOffer;

    expect(await source.current()).toMatchObject({ ok: true });
  });
});

describe('createWorkflowSource notice', () => {
  const second = () =>
    vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementationOnce(refused);

  it('says why a refused code left the workflow on the page as it was', async () => {
    const source = createWorkflowSource(apiWith(second()), 'first');
    const listener = vi.fn();
    source.subscribeNotice(listener);

    await source.offer('second');

    expect(source.notice()).toBe('The launch code is not valid.');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('has no notice before a code is refused', async () => {
    const source = createWorkflowSource(apiWith(second()), 'first');
    await source.current();

    expect(source.notice()).toBeUndefined();
  });

  it('clears the notice when it is dismissed', async () => {
    const source = createWorkflowSource(apiWith(second()), 'first');
    await source.offer('second');

    source.dismissNotice();

    expect(source.notice()).toBeUndefined();
  });

  it('clears the notice when a later code opens a workflow', async () => {
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementationOnce(refused)
      .mockResolvedValueOnce(HELLO_SESSION);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    await source.offer('second');

    await source.offer('third');

    expect(source.notice()).toBeUndefined();
  });

  it('keeps quiet about a refusal when no workflow is on the page, as the page says it', async () => {
    const createSession = vi.fn().mockImplementation(refused);
    const source = createWorkflowSource(apiWith(createSession), 'first');

    await source.offer('second');

    expect(source.notice()).toBeUndefined();
  });

  it('keeps quiet about a refusal that a newer code has overtaken', async () => {
    let refuseOlder!: () => void;
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            refuseOlder = () =>
              reject(new ApiError('The launch code is not valid.', 401));
          }),
      )
      .mockResolvedValueOnce(HELLO_SESSION);
    const source = createWorkflowSource(apiWith(createSession), 'first');
    const older = source.offer('second');
    await source.offer('third');

    refuseOlder();
    await older;

    expect(source.notice()).toBeUndefined();
  });
});
