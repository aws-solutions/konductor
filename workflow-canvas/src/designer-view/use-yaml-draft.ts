// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CHECK_DELAY_MS, SessionLost } from '../designer/core';
import type { Scheduler } from '../execution/core/ports';
import {
  currentAnswer,
  draftStatus,
  reduceDraft,
  startDraft,
  type CheckAnswer,
  type DraftStatus,
  type ValidatePort,
} from './yaml-draft';

const CHECK_FAILED = 'The text could not be checked.';

/** What `useYamlDraft` needs. */
export interface YamlDraftInput {
  /** The text of the workflow as loaded. */
  readonly initialText: string;
  /** The workflow the text is for, sent with each check. */
  readonly name?: string;
  /** The `hash` of the workflow as loaded, `null` for a file not yet saved. */
  readonly baseHash?: string | null;
  /** Read when a check starts, so a new function each render is fine. */
  readonly validate: ValidatePort;
  readonly scheduler: Scheduler;
}

/** The edited YAML text and what its checks say. */
export interface YamlDraftControls {
  readonly text: string;
  readonly status: DraftStatus;
  /** The answer for the text now, once it has come. */
  readonly answer?: CheckAnswer;
  /** The newest answer with no error: its view stays drawable while the text has errors. */
  readonly lastGood?: CheckAnswer;
  /** Why the check of the text now could not be made. */
  readonly failure?: string;
  /**
   * Why no check can be made at all: the server no longer knows the session.
   * It is reported as soon as a check meets it and no edit clears it.
   */
  readonly sessionLost?: string;
  /**
   * The file was written under the draft while it had unsaved edits, so the
   * typed text was kept rather than replaced by the file's.
   */
  readonly baseMoved: boolean;
  edit(text: string): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : CHECK_FAILED;
}

// Which load of a workflow the draft is of. A change of `name` is another
// workflow; a change of hash or loaded text with the same name is the same
// workflow written again, which only moves the base.
function loadKeyOf({ name, baseHash, initialText }: YamlDraftInput): string {
  return JSON.stringify([name ?? null, baseHash ?? null, initialText]);
}

/**
 * Holds the edited YAML text of a workflow and checks it once the person
 * stops typing for `CHECK_DELAY_MS`, with `validate`. A new edit aborts the
 * pause and any check in flight, and the next check starts only after that
 * one has ended, so two never overlap. An answer for older text is dropped.
 * Another workflow opens a fresh draft in the same render: its text, answers
 * and failure start over, and the pause and the check of the one before are
 * aborted. The same workflow loaded again, after a save or because the file
 * changed underneath, replaces the text only while the draft has no unsaved
 * edits; with unsaved edits the typed text is kept and `baseMoved` says the
 * file moved under it. Unmounting aborts both. It never writes the file.
 */
export function useYamlDraft(input: YamlDraftInput): YamlDraftControls {
  const [draft, dispatch] = useReducer(
    reduceDraft,
    input.initialText,
    startDraft,
  );
  const latest = useRef(input);
  const previous = useRef<Promise<unknown>>(Promise.resolve());
  const loadKey = loadKeyOf(input);
  const name = input.name ?? null;
  const [loaded, setLoaded] = useState({ key: loadKey, name });
  // Open in the same render that gets the workflow, as `use-editor.ts` does,
  // so the page never shows the draft of the workflow before.
  if (loaded.key !== loadKey) {
    setLoaded({ key: loadKey, name });
    const unsaved = draft.revision !== draft.opened;
    if (loaded.name !== name || !unsaved) {
      dispatch({ type: 'opened', text: input.initialText });
    } else {
      dispatch({ type: 'base-moved' });
    }
  }

  useEffect(() => {
    latest.current = input;
  });

  const { text, revision, opened } = draft;
  useEffect(() => {
    if (revision === opened) return;
    const controller = new AbortController();
    const { signal } = controller;
    const check = async () => {
      const { validate, scheduler, name: workflow } = latest.current;
      await scheduler.wait(CHECK_DELAY_MS, signal);
      if (signal.aborted) return;
      dispatch({ type: 'check-sent', revision });
      try {
        const request =
          workflow === undefined ? { text } : { name: workflow, text };
        const answer = await validate(request, signal);
        if (!signal.aborted) dispatch({ type: 'checked', revision, answer });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof SessionLost) {
          dispatch({ type: 'session-lost', message: messageOf(error) });
          return;
        }
        dispatch({
          type: 'check-failed',
          revision,
          message: messageOf(error),
        });
      }
    };
    previous.current = previous.current.then(check).catch(() => undefined);
    return () => controller.abort();
  }, [text, revision, opened]);

  const edit = useCallback(
    (next: string) => dispatch({ type: 'edited', text: next }),
    [],
  );
  const answer = currentAnswer(draft);
  const failure =
    draft.failure?.revision === revision ? draft.failure.message : undefined;
  return {
    text,
    status: draftStatus(draft),
    ...(answer ? { answer } : {}),
    ...(draft.lastGood ? { lastGood: draft.lastGood } : {}),
    ...(failure === undefined ? {} : { failure }),
    ...(draft.sessionLost === undefined
      ? {}
      : { sessionLost: draft.sessionLost }),
    baseMoved: draft.baseMoved === true,
    edit,
  };
}
