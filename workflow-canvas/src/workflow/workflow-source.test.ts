// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type WorkflowApi } from '../api/api';
import { HELLO_DOCUMENT, HELLO_SESSION } from '../test-support/fixtures';
import { freshMemory } from '../test-support/memory-storage';
import { createWorkflowSource } from './workflow-source';

function apiWith(
  createSession: WorkflowApi['createSession'],
  getWorkflow: WorkflowApi['getWorkflow'] = vi
    .fn()
    .mockResolvedValue(HELLO_DOCUMENT),
): WorkflowApi {
  return {
    createSession,
    getWorkflow,
    saveWorkflow: vi.fn(),
    checkWorkflow: vi.fn(),
    startRun: vi.fn(),
    getRun: vi.fn(),
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );

    await source.current();
    await source.current();

    expect(createSession).toHaveBeenCalledExactlyOnceWith('first');
  });

  it('changes to the workflow of a new code once its session is open', async () => {
    const createSession = vi.fn().mockResolvedValue(HELLO_SESSION);
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );

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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );

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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(second()),
      'first',
      freshMemory(),
    );
    const listener = vi.fn();
    source.subscribeNotice(listener);

    await source.offer('second');

    expect(source.notice()).toBe('The launch code is not valid.');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('has no notice before a code is refused', async () => {
    const source = createWorkflowSource(
      apiWith(second()),
      'first',
      freshMemory(),
    );
    await source.current();

    expect(source.notice()).toBeUndefined();
  });

  it('clears the notice when it is dismissed', async () => {
    const source = createWorkflowSource(
      apiWith(second()),
      'first',
      freshMemory(),
    );
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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
    await source.offer('second');

    await source.offer('third');

    expect(source.notice()).toBeUndefined();
  });

  it('keeps quiet about a refusal when no workflow is on the page, as the page says it', async () => {
    const createSession = vi.fn().mockImplementation(refused);
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );

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
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      freshMemory(),
    );
    const older = source.offer('second');
    await source.offer('third');

    refuseOlder();
    await older;

    expect(source.notice()).toBeUndefined();
  });
});

describe('createWorkflowSource session memory', () => {
  const KEPT = { token: 'token-1', harness: 'kiro-cli' };

  function memoryWith(record?: typeof KEPT) {
    const memory = freshMemory();
    if (record) memory.remember(record);
    return memory;
  }

  it('keeps the session of the first workflow once it is shown', async () => {
    const memory = memoryWith();
    const createSession = vi.fn().mockResolvedValue(HELLO_SESSION);
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      memory,
    );

    await source.current();

    expect(memory.recall()).toEqual(KEPT);
  });

  it('keeps nothing when the first code is refused', async () => {
    const memory = memoryWith();
    const source = createWorkflowSource(
      apiWith(vi.fn().mockImplementation(refused)),
      'first',
      memory,
    );

    await source.current();

    expect(memory.recall()).toBeUndefined();
  });

  it('keeps the session when the first load fails after the code worked, so a reload resumes', async () => {
    const memory = memoryWith();
    const api = apiWith(
      vi.fn().mockResolvedValue(HELLO_SESSION),
      vi
        .fn()
        .mockRejectedValueOnce(new ApiError('Server error.', 500))
        .mockResolvedValue(HELLO_DOCUMENT),
    );

    expect(
      await createWorkflowSource(api, 'first', memory).current(),
    ).toMatchObject({ ok: false });
    const reloaded = createWorkflowSource(api, undefined, memory);

    expect(await reloaded.current()).toMatchObject({ ok: true });
    expect(api.createSession).toHaveBeenCalledOnce();
  });

  it('keeps the old session when the load of a pasted code fails', async () => {
    const memory = memoryWith(KEPT);
    const api = apiWith(
      vi.fn().mockResolvedValue({ ...HELLO_SESSION, token: 'pasted-token' }),
      vi
        .fn()
        .mockResolvedValueOnce(HELLO_DOCUMENT)
        .mockRejectedValueOnce(new ApiError('Server error.', 500)),
    );
    const source = createWorkflowSource(api, undefined, memory);
    await source.current();

    await source.offer('second');

    expect(memory.recall()).toEqual(KEPT);
  });

  it('opens the kept session when the code in the address is spent', async () => {
    const api = apiWith(
      vi.fn().mockImplementation(refused),
      vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    );
    const source = createWorkflowSource(api, 'spent', memoryWith(KEPT));

    expect(await source.current()).toMatchObject({ ok: true });
  });

  it('tells that the code in the address was refused when it opens the kept session', async () => {
    const api = apiWith(vi.fn().mockImplementation(refused));
    const source = createWorkflowSource(api, 'spent', memoryWith(KEPT));

    await source.current();
    await settleMicrotasks();

    expect(source.notice()).toBe('The launch code is not valid.');
  });

  it('tells nothing when the code in the address opens the workflow', async () => {
    const source = createWorkflowSource(
      apiWith(vi.fn().mockResolvedValue(HELLO_SESSION)),
      'first',
      memoryWith(KEPT),
    );

    await source.current();
    await settleMicrotasks();

    expect(source.notice()).toBeUndefined();
  });

  it('does not open the kept session in place of a refused pasted code', async () => {
    const api = apiWith(
      vi.fn().mockImplementation(refused),
      vi.fn().mockResolvedValue(HELLO_DOCUMENT),
    );
    const source = createWorkflowSource(api, undefined, memoryWith(KEPT));
    const before = source.current();
    await before;

    await source.offer('spent');

    expect(source.current()).toBe(before);
    expect(source.notice()).toBeDefined();
    expect(api.getWorkflow).toHaveBeenCalledOnce();
  });

  it('opens the kept session after a reload, with no code', async () => {
    const createSession = vi.fn();
    const api = apiWith(createSession);
    const source = createWorkflowSource(
      api,
      undefined,
      memoryWith({ token: 'kept-token', harness: 'kept-harness' }),
    );

    expect(await source.current()).toMatchObject({
      ok: true,
      workflow: { harness: 'kept-harness' },
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(api.getWorkflow).toHaveBeenCalledWith('kept-token');
  });

  it('replaces the kept session with the one of a pasted code that works', async () => {
    const memory = memoryWith({ token: 'old-token', harness: 'old' });
    const createSession = vi
      .fn()
      .mockResolvedValue({ ...HELLO_SESSION, token: 'new-token' });
    const source = createWorkflowSource(
      apiWith(createSession),
      undefined,
      memory,
    );
    await source.current();

    await source.offer('second');

    expect(memory.recall()).toEqual({
      token: 'new-token',
      harness: 'kiro-cli',
    });
  });

  it('keeps the old session when a pasted code is refused', async () => {
    const memory = memoryWith();
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementationOnce(refused);
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      memory,
    );
    await source.current();

    await source.offer('second');

    expect(memory.recall()).toEqual(KEPT);
  });

  it('keeps the session of the newest code when an older one arrives late', async () => {
    const memory = memoryWith();
    const answers: Array<(session: typeof HELLO_SESSION) => void> = [];
    const createSession = vi
      .fn()
      .mockResolvedValueOnce(HELLO_SESSION)
      .mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      memory,
    );
    const older = source.offer('second');
    const newer = source.offer('third');

    answers[1]!({ ...HELLO_SESSION, token: 'newer-token' });
    await newer;
    answers[0]!({ ...HELLO_SESSION, token: 'older-token' });
    await older;

    expect(memory.recall()?.token).toBe('newer-token');
  });

  it('keeps the session of a pasted code when the first load answers after it', async () => {
    const memory = memoryWith();
    let answerFirst!: (session: typeof HELLO_SESSION) => void;
    const createSession = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (answerFirst = resolve)),
      )
      .mockResolvedValueOnce({ ...HELLO_SESSION, token: 'pasted-token' });
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      memory,
    );

    await source.offer('second');
    answerFirst({ ...HELLO_SESSION, token: 'first-token' });
    await settleMicrotasks();

    expect(memory.recall()?.token).toBe('pasted-token');
  });

  it('keeps the session of a pasted code when the first open answers after it over a kept session', async () => {
    const memory = memoryWith({ token: 'old-token', harness: 'old' });
    let answerFirst!: (session: typeof HELLO_SESSION) => void;
    const createSession = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (answerFirst = resolve)),
      )
      .mockResolvedValueOnce({ ...HELLO_SESSION, token: 'pasted-token' });
    const source = createWorkflowSource(
      apiWith(createSession),
      'first',
      memory,
    );

    await source.offer('second');
    answerFirst({ ...HELLO_SESSION, token: 'first-token' });
    await settleMicrotasks();

    expect(memory.recall()?.token).toBe('pasted-token');
  });

  it('forgets a kept session that the server no longer knows', async () => {
    const memory = memoryWith(KEPT);
    const api = {
      ...apiWith(vi.fn()),
      getWorkflow: vi.fn().mockRejectedValue(new ApiError('Wrong.', 401)),
    };
    const source = createWorkflowSource(api, undefined, memory);

    expect(await source.current()).toMatchObject({ ok: false });
    expect(memory.recall()).toBeUndefined();
  });
});
