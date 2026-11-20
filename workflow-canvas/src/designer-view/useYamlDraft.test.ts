// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeScheduler } from '../test-support/fake-scheduler';
import { useYamlDraft, type YamlDraftInput } from './useYamlDraft';
import {
  CHECK_PAUSE_MS,
  type CheckAnswer,
  type CheckRequest,
  type ValidatePort,
} from './yaml-draft';

const GOOD: CheckAnswer = {
  errors: 0,
  warnings: 0,
  infos: 0,
  view: {
    format: 'konductor/1',
    version: '0.1.0',
    name: 'hello',
    intent: { outcome: 'Add a greeting' },
    stages: [{ name: 'write' }],
  },
  diagnostics: [],
};
const BAD: CheckAnswer = { ...GOOD, errors: 1, view: null };

/** A check whose every call waits until the test answers it. */
class HeldValidate {
  readonly requests: CheckRequest[] = [];
  readonly signals: AbortSignal[] = [];
  inFlight = 0;
  mostInFlight = 0;
  private held: {
    resolve: (answer: CheckAnswer) => void;
    reject: (error: Error) => void;
  }[] = [];

  readonly port: ValidatePort = (request, signal) => {
    this.requests.push(request);
    this.signals.push(signal);
    this.inFlight += 1;
    this.mostInFlight = Math.max(this.mostInFlight, this.inFlight);
    return new Promise<CheckAnswer>((resolve, reject) => {
      this.held.push({ resolve, reject });
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    }).finally(() => {
      this.inFlight -= 1;
    });
  };

  async answer(index: number, answer: CheckAnswer): Promise<void> {
    await act(async () => this.held[index]?.resolve(answer));
  }

  async fail(index: number, error: Error): Promise<void> {
    await act(async () => this.held[index]?.reject(error));
  }
}

function setUp(input: Partial<YamlDraftInput> = {}) {
  const validate = new HeldValidate();
  const scheduler = new FakeScheduler();
  const hook = renderHook(() =>
    useYamlDraft({
      initialText: 'v0',
      name: 'hello',
      validate: validate.port,
      scheduler,
      ...input,
    }),
  );
  // The pause starts once the check before it has ended, a step later.
  const pause = async () => {
    await act(async () => {});
    await act(async () => scheduler.tick());
  };
  return { ...hook, validate, scheduler, pause };
}

describe('useYamlDraft', () => {
  it('checks nothing until the text is edited', async () => {
    const { result, validate, scheduler } = setUp();
    await act(async () => {});

    expect(result.current.text).toBe('v0');
    expect(result.current.status).toBe('unchecked');
    expect(scheduler.waits).toEqual([]);
    expect(validate.requests).toEqual([]);
  });

  it('waits for the pause after typing, then checks the text once', async () => {
    const { result, validate, scheduler, pause } = setUp();
    act(() => result.current.edit('v1'));
    act(() => result.current.edit('v12'));

    expect(result.current.text).toBe('v12');
    expect(result.current.status).toBe('waiting');
    await act(async () => {});
    expect(validate.requests).toEqual([]);
    expect(scheduler.pendingCount).toBe(1);
    await pause();

    expect(scheduler.waits.every((ms) => ms === CHECK_PAUSE_MS)).toBe(true);
    expect(validate.requests).toEqual([{ name: 'hello', text: 'v12' }]);
    expect(result.current.status).toBe('checking');
    await validate.answer(0, GOOD);
    expect(result.current.status).toBe('valid');
    expect(result.current.answer).toBe(GOOD);
  });

  it('sends no name when it has none', async () => {
    const { result, validate, pause } = setUp({ name: undefined });
    act(() => result.current.edit('v1'));
    await pause();

    expect(validate.requests).toEqual([{ text: 'v1' }]);
  });

  it('aborts the check in flight on a new edit, and drops its late answer', async () => {
    const { result, validate, pause } = setUp();
    act(() => result.current.edit('v1'));
    await pause();
    act(() => result.current.edit('v2'));

    expect(validate.signals[0]?.aborted).toBe(true);
    await validate.answer(0, BAD);
    expect(result.current.status).toBe('waiting');
    expect(result.current.answer).toBeUndefined();

    await pause();
    expect(validate.requests.map((r) => r.text)).toEqual(['v1', 'v2']);
    await validate.answer(1, GOOD);
    expect(result.current.status).toBe('valid');
    expect(validate.mostInFlight).toBe(1);
  });

  it('keeps the last good answer and its view while the text has errors', async () => {
    const { result, validate, pause } = setUp();
    act(() => result.current.edit('v1'));
    await pause();
    await validate.answer(0, GOOD);
    act(() => result.current.edit('v1 broken'));
    await pause();
    await validate.answer(1, BAD);

    expect(result.current.status).toBe('invalid');
    expect(result.current.answer).toBe(BAD);
    expect(result.current.lastGood?.view?.stages).toEqual([{ name: 'write' }]);
  });

  it('says why a check failed, and checks again after the next edit', async () => {
    const { result, validate, pause } = setUp();
    act(() => result.current.edit('v1'));
    await pause();
    await validate.fail(0, new Error('The server did not answer.'));

    expect(result.current.status).toBe('failed');
    expect(result.current.failure).toBe('The server did not answer.');

    act(() => result.current.edit('v2'));
    expect(result.current.failure).toBeUndefined();
    await pause();
    await validate.answer(1, GOOD);
    expect(result.current.status).toBe('valid');
  });

  it('gives a plain sentence for a failure with no message', async () => {
    const { result, validate, pause } = setUp();
    act(() => result.current.edit('v1'));
    await pause();
    await validate.fail(0, new Error(''));

    expect(result.current.failure).toBe('The text could not be checked.');
  });

  it('aborts the pause and the check in flight on unmount, with no update after', async () => {
    const { result, validate, scheduler, pause, unmount } = setUp();
    act(() => result.current.edit('v1'));
    await pause();
    act(() => result.current.edit('v2'));
    const before = result.current;
    unmount();
    await act(async () => {});

    expect(validate.signals.every((signal) => signal.aborted)).toBe(true);
    expect(scheduler.pendingCount).toBe(0);
    expect(validate.inFlight).toBe(0);
    expect(result.current).toBe(before);
  });
});
