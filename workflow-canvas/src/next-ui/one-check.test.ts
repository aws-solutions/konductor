// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import type { CheckAnswer, ValidateRequest } from '../designer-view/yaml-draft';
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
  const validate = vi.fn((request: ValidateRequest, signal: AbortSignal) => {
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

/**
 * A reader the test starts and does not read. A reader whose signal aborts
 * fails, as the port says it does, so its failure is taken here rather than
 * left for the runner to report.
 */
const reading = (answer: Promise<unknown>): void => {
  void answer.catch(() => undefined);
};

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

  it('starts its own call for newer text and leaves the one before it to finish', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    const first = shared.check('one');
    void shared.validate({ text: 'two' }, signalOf().signal);

    expect(server.calls).toHaveLength(2);
    expect(server.calls[0]?.signal.aborted).toBe(false);
    expect(server.calls[1]?.signal.aborted).toBe(false);
    server.answers[0]?.(answerOf());
    expect((await first).diagnostics).toHaveLength(1);
  });

  it('aborts the call when the reader that waits for it gives up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const mine = signalOf();

    reading(shared.validate({ text: 'one' }, mine.signal));
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
    // The reader that gave up is answered then and there, and not with the
    // answer it is no longer waiting for: its caller checks one text at a
    // time, and a check it has called off would hold the next one back.
    await expect(drawn).rejects.toThrow('The check was called off.');
  });

  it('asks nothing for a reader that has already given up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const mine = signalOf();
    mine.abort();

    const drawn = shared.validate({ text: 'one' }, mine.signal);

    expect(server.calls).toHaveLength(0);
    await expect(drawn).rejects.toThrow('The check was called off.');
  });

  it('aborts the call once the last reader of it has given up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const first = signalOf();
    const second = signalOf();
    reading(shared.validate({ text: 'one' }, first.signal));
    reading(shared.validate({ text: 'one' }, second.signal));

    first.abort();
    expect(server.calls[0]?.signal.aborted).toBe(false);
    second.abort();

    expect(server.calls[0]?.signal.aborted).toBe(true);
  });

  it('makes the call again for a text whose readers all gave up', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const mine = signalOf();
    reading(shared.validate({ text: 'one' }, mine.signal));
    mine.abort();

    const judged = shared.check('one');
    server.answers[1]?.(answerOf());

    expect(server.calls).toHaveLength(2);
    expect((await judged).diagnostics).toHaveLength(1);
  });

  // The race the first check of a loaded text and the first edit set up: the
  // view asks for the loaded text, the editor's check of the edited text
  // starts before that answer comes, and the first reader must still get its
  // own answer rather than the abort of a call it never called off.
  it('answers the reader of the first check when an edit starts its own', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const opened = signalOf();
    const first = shared.validate({ text: 'one' }, opened.signal);
    reading(first);

    const edited = shared.check('two');

    expect(server.calls).toHaveLength(2);
    expect(server.calls[0]?.signal.aborted).toBe(false);
    expect(opened.signal.aborted).toBe(false);
    server.answers[1]?.(answerOf());
    expect((await edited).diagnostics).toHaveLength(1);
    server.answers[0]?.(answerOf());
    await expect(first).resolves.toBeTruthy();
  });

  it('answers both readers when an undo and a redo walk back over a text', async () => {
    const server = held();
    const shared = oneCheck(server.validate);
    const opened = signalOf();
    // The view still waits for the text as loaded.
    const first = shared.validate({ text: 'one' }, opened.signal);
    reading(first);
    // Undo goes to another text, and redo comes back to the first.
    const undone = shared.check('two');
    const redone = shared.check('one');

    // The text as loaded is already in flight, so redo joins that call.
    expect(server.calls).toHaveLength(2);
    expect(server.calls.every((one) => !one.signal.aborted)).toBe(true);
    server.answers[0]?.(answerOf());
    server.answers[1]?.(answerOf());

    await expect(first).resolves.toBeTruthy();
    expect((await undone).diagnostics).toHaveLength(1);
    expect((await redone).diagnostics).toHaveLength(1);
  });

  it('makes one call per text, whichever reader asks first', async () => {
    const server = held();
    const shared = oneCheck(server.validate);

    void shared.check('one');
    void shared.validate({ text: 'one' }, signalOf().signal);
    void shared.check('one');

    expect(server.calls).toHaveLength(1);
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
