// SPDX-License-Identifier: Apache-2.0

/*
 * The shapes of `POST /api/validate` (`checkWorkflow`) in `api/openapi.yaml`,
 * narrowed to what the draft keeps. They are local until the API client is
 * reworked to give them.
 */

/**
 * The body of `POST /api/validate`. It is named apart from `designer/core`'s
 * `CheckRequest`, which is the argument of `checkAfterPause`.
 */
export interface ValidateRequest {
  /** The workflow the text is for; the server takes the root without it. */
  readonly name?: string;
  readonly text: string;
}

/** One finding of the check, with its place in the text. */
export interface CheckDiagnostic {
  /** A stable code. A later release may add codes. */
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly end_line: number;
  readonly end_column: number;
  readonly message: string;
  readonly suggestion?: string;
}

/** One stage of the parsed workflow, with the keys of the file. */
export interface CheckViewStage {
  readonly name: string;
  readonly [key: string]: unknown;
}

/** The parsed workflow, ready to draw. */
export interface CheckView {
  readonly format: string;
  readonly version: string;
  readonly name: string;
  readonly intent: unknown;
  readonly stages: readonly CheckViewStage[];
}

/** The answer of `POST /api/validate`. */
export interface CheckAnswer {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  /** `null` when `errors` is above 0. */
  readonly view: CheckView | null;
  readonly diagnostics: readonly CheckDiagnostic[];
}

/**
 * Checks a text, as `POST /api/validate` does. It rejects when its signal
 * aborts, with `SessionLost` when the server answered 401, and writes
 * nothing. The pause before each call is `CHECK_DELAY_MS` of
 * `designer/core/run-check.ts`, which the hook holds.
 */
export type ValidatePort = (
  request: ValidateRequest,
  signal: AbortSignal,
) => Promise<CheckAnswer>;

/** The edited text of a workflow, and what the checks have said of it. */
export interface YamlDraft {
  readonly text: string;
  /**
   * The text of the file the draft is of, as it was last read. The draft has
   * unsaved work only while `text` differs from it, so an edit that is undone
   * back to the file leaves nothing unsaved, whatever the revision says.
   */
  readonly base: string;
  /**
   * Goes up by one with each edit and each open, so an answer names the text
   * it is for, and an answer for a workflow opened before is dropped.
   */
  readonly revision: number;
  /** The revision of the last open: the text as loaded, which is not checked. */
  readonly opened: number;
  /** The revision whose check is in flight. */
  readonly sent?: number;
  /** The latest answer, and the revision it is for. */
  readonly checked?: {
    readonly revision: number;
    readonly answer: CheckAnswer;
  };
  /** The newest answer with no error, which has a view to draw. */
  readonly lastGood?: CheckAnswer;
  /** Why the check of a revision could not be made. */
  readonly failure?: { readonly revision: number; readonly message: string };
  /**
   * The server no longer knows the session, so no check or save will work.
   * It is not tied to a revision and no edit clears it, as the editor path
   * reports a lost session at once and keeps reporting it.
   */
  readonly sessionLost?: string;
  /**
   * The file was written under the draft while it had unsaved edits, so the
   * typed text was kept and its base moved. Cleared only by an open.
   */
  readonly baseMoved?: boolean;
}

/** What happened to the draft. */
export type DraftEvent =
  | { readonly type: 'opened'; readonly text: string }
  | {
      readonly type: 'base-moved';
      /** The text of the file as it is now, which the draft is measured against. */
      readonly text: string;
    }
  | { readonly type: 'edited'; readonly text: string }
  | { readonly type: 'check-sent'; readonly revision: number }
  | { readonly type: 'session-lost'; readonly message: string }
  | {
      readonly type: 'checked';
      readonly revision: number;
      readonly answer: CheckAnswer;
    }
  | {
      readonly type: 'check-failed';
      readonly revision: number;
      readonly message: string;
    };

/** A draft of `text` that no check has looked at, with `text` as its base. */
export function startDraft(text: string): YamlDraft {
  return { text, base: text, revision: 0, opened: 0 };
}

// The draft with no check in flight and no failure. A lost session and a
// moved base are not of one revision, so both are kept.
function settled(draft: YamlDraft): YamlDraft {
  const {
    text,
    base,
    revision,
    opened,
    checked,
    lastGood,
    sessionLost,
    baseMoved,
  } = draft;
  return {
    text,
    base,
    revision,
    opened,
    ...(checked ? { checked } : {}),
    ...(lastGood ? { lastGood } : {}),
    ...(sessionLost === undefined ? {} : { sessionLost }),
    ...(baseMoved ? { baseMoved } : {}),
  };
}

function isGood(answer: CheckAnswer): boolean {
  return answer.errors === 0 && answer.view !== null;
}

/**
 * The draft after `event`. An open, as of another workflow, starts again
 * from its text, which becomes its base: every answer, failure, lost session
 * and check of the text before is dropped. A moved base takes the file's new
 * text as the base and keeps the typed text and its revision, so the check
 * already made for it still stands. An edit to the same text
 * changes nothing. An answer or a failure for an older revision is dropped,
 * as the text it was for is gone, and so is the answer of a check that was
 * not sent. A lost session is kept whatever comes after it.
 */
export function reduceDraft(draft: YamlDraft, event: DraftEvent): YamlDraft {
  if (event.type === 'opened') {
    const revision = draft.revision + 1;
    return { text: event.text, base: event.text, revision, opened: revision };
  }
  if (event.type === 'base-moved') {
    // The file moved under the typed text, so what is unsaved is now that
    // text against the file as it is: the base moves, the text stays.
    if (draft.base === event.text && draft.baseMoved) return draft;
    return { ...draft, base: event.text, baseMoved: true };
  }
  if (event.type === 'session-lost') {
    return { ...settled(draft), sessionLost: event.message };
  }
  if (event.type === 'edited') {
    if (event.text === draft.text) return draft;
    return {
      ...settled(draft),
      text: event.text,
      revision: draft.revision + 1,
    };
  }
  if (event.revision !== draft.revision) return draft;
  if (event.type === 'check-sent') return { ...draft, sent: event.revision };
  if (draft.sent !== event.revision) return draft;
  if (event.type === 'check-failed') {
    return {
      ...settled(draft),
      failure: { revision: event.revision, message: event.message },
    };
  }
  return {
    ...settled(draft),
    checked: { revision: event.revision, answer: event.answer },
    ...(isGood(event.answer) ? { lastGood: event.answer } : {}),
  };
}

/** Where the check of the current text is. */
export type DraftStatus =
  'unchecked' | 'waiting' | 'checking' | 'valid' | 'invalid' | 'failed';

/** The answer for the current text, or `undefined` until it comes. */
export function currentAnswer(draft: YamlDraft): CheckAnswer | undefined {
  return draft.checked?.revision === draft.revision
    ? draft.checked.answer
    : undefined;
}

/**
 * Where the check of the current text is: `unchecked` before any edit,
 * `waiting` for the person to stop typing, `checking` while the call is in
 * flight, then `valid`, `invalid` or `failed`. An answer is `valid` only with
 * no error and a view to draw, the rule `lastGood` follows. A lost session is
 * `failed` from then on, as no later check can be made.
 */
export function draftStatus(draft: YamlDraft): DraftStatus {
  if (draft.sessionLost !== undefined) return 'failed';
  if (draft.sent === draft.revision) return 'checking';
  if (draft.failure?.revision === draft.revision) return 'failed';
  const answer = currentAnswer(draft);
  if (answer) return isGood(answer) ? 'valid' : 'invalid';
  return draft.revision === draft.opened ? 'unchecked' : 'waiting';
}
