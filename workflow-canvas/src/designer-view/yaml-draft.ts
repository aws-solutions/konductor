// SPDX-License-Identifier: Apache-2.0

/*
 * The shapes of `POST /api/validate` (`checkWorkflow`) in `api/openapi.yaml`,
 * narrowed to what the draft keeps. They are local until the API client is
 * reworked to give them.
 */

/** The body of `POST /api/validate`. */
export interface CheckRequest {
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
  /** Every other key of the parsed workflow, such as the `params` of a file. */
  readonly [key: string]: unknown;
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
 * aborts, and writes nothing.
 */
export type ValidatePort = (
  request: CheckRequest,
  signal: AbortSignal,
) => Promise<CheckAnswer>;

/** How long the person must stop typing before the text is checked. */
export const CHECK_PAUSE_MS = 400;

/** The edited text of a workflow, and what the checks have said of it. */
export interface YamlDraft {
  readonly text: string;
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
}

/** What happened to the draft. */
export type DraftEvent =
  | { readonly type: 'opened'; readonly text: string }
  | { readonly type: 'edited'; readonly text: string }
  | { readonly type: 'check-sent'; readonly revision: number }
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

/** A draft of `text` that no check has looked at. */
export function startDraft(text: string): YamlDraft {
  return { text, revision: 0, opened: 0 };
}

// The draft with no check in flight and no failure.
function settled(draft: YamlDraft): YamlDraft {
  const { text, revision, opened, checked, lastGood } = draft;
  return {
    text,
    revision,
    opened,
    ...(checked ? { checked } : {}),
    ...(lastGood ? { lastGood } : {}),
  };
}

function isGood(answer: CheckAnswer): boolean {
  return answer.errors === 0 && answer.view !== null;
}

/**
 * The draft after `event`. An open, as of another workflow, starts again
 * from its text: every answer, failure and check of the text before is
 * dropped. An edit to the same text changes nothing. An answer or a failure
 * for an older revision is dropped, as the text it was for is gone, and so
 * is the answer of a check that was not sent.
 */
export function reduceDraft(draft: YamlDraft, event: DraftEvent): YamlDraft {
  if (event.type === 'opened') {
    const revision = draft.revision + 1;
    return { text: event.text, revision, opened: revision };
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
 * no error and a view to draw, the rule `lastGood` follows.
 */
export function draftStatus(draft: YamlDraft): DraftStatus {
  if (draft.sent === draft.revision) return 'checking';
  if (draft.failure?.revision === draft.revision) return 'failed';
  const answer = currentAnswer(draft);
  if (answer) return isGood(answer) ? 'valid' : 'invalid';
  return draft.revision === draft.opened ? 'unchecked' : 'waiting';
}
