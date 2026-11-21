// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import type { CheckAnswer, CheckRequest } from '../designer-view/yaml-draft';
import { SessionLost } from '../designer/core';
import { oneCheck } from './one-check';

const VIEW: NonNullable<CheckAnswer['view']> = {
  format: 'konductor/1',
  version: '0.1.0',
  name: 'hello',
  intent: { outcome: 'Add a greeting' },
  stages: [
    {
      name: 'draft',
      kind: 'agent',
      agent: 'k-developer',
      prompt: 'Write it.',
      range: { line: 7, end_line: 9 },
    },
  ],
};

const FINDING = {
  code: 'UNKNOWN_KEY',
  severity: 'warning' as const,
  path: 'stages[0].nope',
  line: 2,
  column: 3,
  end_line: 2,
  end_column: 7,
  message: 'A key.',
};

const answerOf = (over: Partial<CheckAnswer> = {}): CheckAnswer => ({
  errors: 0,
  warnings: 1,
  infos: 0,
  view: VIEW,
  diagnostics: [FINDING],
  ...over,
});

/** A check that answers when the test says so, and reports its calls. */
function held() {
  const calls: { text: string; name?: string; signal: AbortSignal }[] = [];
  const answers: ((answer: CheckAnswer) => void)[] = [];
  const fails: ((error: unknown) => void)[] = [];
  const validate = vi.fn((request: CheckRequest, signal: AbortSignal) => {
    calls.push({
      text: request.text,
      ...(request.name === undefined ? {} : { name: request.name }),
      signal,
    });
    return new Promise<CheckAnswer>((resolve, reject) => {
      answers.push(resolve);
      fails.push(reject);
    });
  });
  return { calls, answers, fails, validate };
}

const signalOf = () => new AbortController();

describe('oneCheck', () => {
  it('makes one call for the text both readers ask about', async () => {
    const server = held();
    const shared = oneCheck(server.validate, 'hello');

    const drawn = shared.validate({ text: 'one' }, signalOf().signal);
    const judged = shared.check('one');
    server.answers[0]?.(answerOf());

    expect(server.calls).toHaveLength(1);
    expect((await drawn).view?.stages[0]?.prompt).toBe('Write it.');
    expect((await judged).diagnostics).toEqual([
      {
        message: 'A key.',
        path: 'stages[0].nope',
        line: 2,
        severity: 'warning',
      },
    ]);
  });

  it('sends the workflow the text is for, whoever asks', async () => {
    const server = held();
    const shared = oneCheck(server.validate, 'hello');

    void shared.check('one');
    server.answers[0]?.(answerOf());
    await Promise.resolve();

    expect(server.calls[0]?.name).toBe('hello');
    expect(server.calls[0]?.text).toBe('one');
  });

  it('gives the editor the workflow of the answer, without the keys it has no use for', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    const judged = shared.check('one');
    server.answers[0]?.(answerOf());

    expect((await judged).view).toEqual({
      name: 'hello',
      intent: { outcome: 'Add a greeting' },
      stages: [{ name: 'draft', agent: 'k-developer' }],
    });
  });

  it('gives the editor no workflow when the text has errors', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    const judged = shared.check('one');
    server.answers[0]?.(answerOf({ view: null, errors: 1 }));

    expect((await judged).view).toBeNull();
  });

  it('takes the place of a call for another text, and aborts it', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    const first = shared.check('one');
    void shared.validate({ text: 'two' }, signalOf().signal);

    expect(server.calls).toHaveLength(2);
    expect(server.calls[0]?.signal.aborted).toBe(true);
    expect(server.calls[1]?.signal.aborted).toBe(false);
    server.fails[0]?.(new DOMException('Aborted', 'AbortError'));
    await expect(first).rejects.toThrow('Aborted');
  });

  it('aborts the call when the reader that waits for it gives up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const mine = signalOf();

    void shared.validate({ text: 'one' }, mine.signal);
    mine.abort();

    expect(server.calls[0]?.signal.aborted).toBe(true);
  });

  it('holds the call for the other reader when one gives up', async () => {
    // The page takes the Design view off while the editor is still waiting
    // for the answer that says whether the draft may be saved.
    const server = held();
    const shared = oneCheck(server.validate);
    const mine = signalOf();
    const drawn = shared.validate({ text: 'one' }, mine.signal);
    const judged = shared.check('one');

    mine.abort();
    server.answers[0]?.(answerOf());

    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]?.signal.aborted).toBe(false);
    expect((await judged).diagnostics).toHaveLength(1);
    await expect(drawn).resolves.toBeDefined();
  });

  it('aborts the call once the last reader of it has given up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const first = signalOf();
    const second = signalOf();
    void shared.validate({ text: 'one' }, first.signal);
    void shared.validate({ text: 'one' }, second.signal);

    first.abort();
    expect(server.calls[0]?.signal.aborted).toBe(false);
    second.abort();

    expect(server.calls[0]?.signal.aborted).toBe(true);
  });

  it('makes the call again for a text whose readers all gave up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const mine = signalOf();
    void shared.validate({ text: 'one' }, mine.signal);
    mine.abort();

    const judged = shared.check('one');
    server.answers[1]?.(answerOf());

    expect(server.calls).toHaveLength(2);
    expect((await judged).diagnostics).toHaveLength(1);
  });

  it('still aborts a call that newer text replaces, whoever waits for it', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    void shared.check('one');

    void shared.validate({ text: 'two' }, signalOf().signal);

    expect(server.calls[0]?.signal.aborted).toBe(true);
    expect(server.calls[1]?.signal.aborted).toBe(false);
  });

  it('makes the call again for a text whose call failed', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const first = shared.check('one');
    server.fails[0]?.(new Error('The server said no.'));
    await expect(first).rejects.toThrow('The server said no.');

    const again = shared.check('one');
    server.answers[1]?.(answerOf());

    expect(server.calls).toHaveLength(2);
    expect((await again).diagnostics).toHaveLength(1);
  });

  it('tells the editor a lost session in the way it reads', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    const judged = shared.check('one');
    server.fails[0]?.(new ApiError('The session is gone.', 401));

    await expect(judged).rejects.toThrow(SessionLost);
  });

  it('leaves every other failure as it is', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    const judged = shared.check('one');
    server.fails[0]?.(new ApiError('The server broke.', 500));

    await expect(judged).rejects.toThrow('The server broke.');
  });
});
