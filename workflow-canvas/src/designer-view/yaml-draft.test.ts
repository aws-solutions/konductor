// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  currentAnswer,
  draftStatus,
  reduceDraft,
  startDraft,
  type CheckAnswer,
  type DraftEvent,
  type YamlDraft,
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
    stages: [{ name: 'write', agent: 'k-developer' }],
  },
  diagnostics: [],
};

const BAD: CheckAnswer = {
  errors: 1,
  warnings: 0,
  infos: 0,
  view: null,
  diagnostics: [
    {
      code: 'DUPLICATE_STAGE',
      severity: 'error',
      path: 'stages.write',
      line: 9,
      column: 11,
      end_line: 9,
      end_column: 16,
      message: 'Two stages are named write.',
    },
  ],
};

function after(...events: DraftEvent[]): YamlDraft {
  return events.reduce(reduceDraft, startDraft('v0'));
}

const edited = (text: string): DraftEvent => ({ type: 'edited', text });
const sent = (revision: number): DraftEvent => ({
  type: 'check-sent',
  revision,
});
const checked = (revision: number, answer: CheckAnswer): DraftEvent => ({
  type: 'checked',
  revision,
  answer,
});

describe('reduceDraft', () => {
  it('starts unchecked, then waits after an edit', () => {
    expect(draftStatus(startDraft('v0'))).toBe('unchecked');

    const draft = after(edited('v1'));
    expect(draft).toEqual({ text: 'v1', revision: 1, opened: 0 });
    expect(draftStatus(draft)).toBe('waiting');
  });

  it('changes nothing for an edit to the same text', () => {
    const draft = after(edited('v1'));

    expect(reduceDraft(draft, edited('v1'))).toBe(draft);
  });

  it('is checking once the check is sent, and valid or invalid with its answer', () => {
    expect(draftStatus(after(edited('v1'), sent(1)))).toBe('checking');

    const good = after(edited('v1'), sent(1), checked(1, GOOD));
    expect(draftStatus(good)).toBe('valid');
    expect(currentAnswer(good)).toBe(GOOD);

    const bad = after(edited('v1'), sent(1), checked(1, BAD));
    expect(draftStatus(bad)).toBe('invalid');
  });

  it('drops an answer for older text', () => {
    const draft = after(edited('v1'), sent(1), edited('v2'));

    expect(reduceDraft(draft, checked(1, BAD))).toBe(draft);
    expect(draftStatus(draft)).toBe('waiting');
  });

  it('drops an answer to a check that was not sent, and a send for older text', () => {
    const draft = after(edited('v1'));

    expect(reduceDraft(draft, checked(1, GOOD))).toBe(draft);
    expect(reduceDraft(draft, sent(0))).toBe(draft);
  });

  it('keeps the last good answer and its view while the text has errors', () => {
    const draft = after(
      edited('v1'),
      sent(1),
      checked(1, GOOD),
      edited('v2'),
      sent(2),
      checked(2, BAD),
    );

    expect(draftStatus(draft)).toBe('invalid');
    expect(currentAnswer(draft)).toBe(BAD);
    expect(draft.lastGood?.view?.stages).toEqual([
      { name: 'write', agent: 'k-developer' },
    ]);
  });

  it('takes an answer with no error but no view as not good, and its text as invalid', () => {
    const draft = after(
      edited('v1'),
      sent(1),
      checked(1, { ...GOOD, view: null }),
    );

    expect(draft.lastGood).toBeUndefined();
    expect(draftStatus(draft)).toBe('invalid');
  });

  it('starts over on an open, dropping every answer, failure and check before it', () => {
    const before = after(
      edited('v1'),
      sent(1),
      checked(1, GOOD),
      edited('v2'),
      sent(2),
    );
    const draft = reduceDraft(before, { type: 'opened', text: 'other' });

    expect(draft).toEqual({ text: 'other', revision: 3, opened: 3 });
    expect(draftStatus(draft)).toBe('unchecked');
    expect(currentAnswer(draft)).toBeUndefined();
    expect(reduceDraft(draft, checked(2, BAD))).toBe(draft);
  });

  it('starts over on an open of the same text', () => {
    const before = after(edited('v1'), sent(1), checked(1, GOOD));
    const draft = reduceDraft(before, { type: 'opened', text: 'v1' });

    expect(draft.lastGood).toBeUndefined();
    expect(draftStatus(draft)).toBe('unchecked');
  });

  it('says why a check failed, until the next edit', () => {
    const failed = after(edited('v1'), sent(1), {
      type: 'check-failed',
      revision: 1,
      message: 'The server did not answer.',
    });

    expect(draftStatus(failed)).toBe('failed');
    expect(failed.failure?.message).toBe('The server did not answer.');
    const next = reduceDraft(failed, edited('v2'));
    expect(next.failure).toBeUndefined();
    expect(draftStatus(next)).toBe('waiting');
  });

  it('drops a failure for older text', () => {
    const draft = after(edited('v1'), sent(1), edited('v2'));

    expect(
      reduceDraft(draft, { type: 'check-failed', revision: 1, message: 'x' }),
    ).toBe(draft);
  });

  it('keeps an answer for older text out of the current answer', () => {
    const draft = after(edited('v1'), sent(1), checked(1, GOOD), edited('v2'));

    expect(currentAnswer(draft)).toBeUndefined();
    expect(draft.lastGood).toBe(GOOD);
  });

  it('keeps a lost session whatever comes after, until an open', () => {
    const lost = after(edited('v1'), sent(1), {
      type: 'session-lost',
      message: 'Open the workflow again.',
    });

    expect(lost.sessionLost).toBe('Open the workflow again.');
    expect(lost.sent).toBeUndefined();
    expect(draftStatus(lost)).toBe('failed');

    const typed = reduceDraft(lost, edited('v2'));
    expect(typed.sessionLost).toBe('Open the workflow again.');
    expect(draftStatus(typed)).toBe('failed');

    const opened = reduceDraft(typed, { type: 'opened', text: 'other' });
    expect(opened.sessionLost).toBeUndefined();
    expect(draftStatus(opened)).toBe('unchecked');
  });

  it('keeps the text, its revision and its answer when the base moves', () => {
    const before = after(edited('v1'), sent(1), checked(1, GOOD));
    const moved = reduceDraft(before, { type: 'base-moved' });

    expect(moved.text).toBe('v1');
    expect(moved.revision).toBe(before.revision);
    expect(moved.baseMoved).toBe(true);
    expect(currentAnswer(moved)).toBe(GOOD);
    expect(draftStatus(moved)).toBe('valid');

    expect(reduceDraft(moved, { type: 'base-moved' })).toBe(moved);
    expect(reduceDraft(moved, edited('v2')).baseMoved).toBe(true);
    expect(
      reduceDraft(moved, { type: 'opened', text: 'v1' }).baseMoved,
    ).toBeUndefined();
  });
});
