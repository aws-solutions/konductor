// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Scheduler } from '../execution/core/ports';
import {
  CHECK_PAUSE_MS,
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
  readonly initialText: string;
  /** The workflow the text is for, sent with each check. */
  readonly name?: string;
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
  edit(text: string): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : CHECK_FAILED;
}

/**
 * Holds the edited YAML text of a workflow and checks it once the person
 * stops typing for `CHECK_PAUSE_MS`, with `validate`. A new edit aborts the
 * pause and any check in flight, and the next check starts only after that
 * one has ended, so two never overlap. An answer for older text is dropped.
 * Unmounting aborts both. It never writes the file.
 */
export function useYamlDraft(input: YamlDraftInput): YamlDraftControls {
  const [draft, dispatch] = useReducer(
    reduceDraft,
    input.initialText,
    startDraft,
  );
  const latest = useRef(input);
  const previous = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    latest.current = input;
  });

  const { text, revision } = draft;
  useEffect(() => {
    if (revision === 0) return;
    const controller = new AbortController();
    const { signal } = controller;
    const check = async () => {
      const { validate, scheduler, name } = latest.current;
      await scheduler.wait(CHECK_PAUSE_MS, signal);
      if (signal.aborted) return;
      dispatch({ type: 'check-sent', revision });
      try {
        const request = name === undefined ? { text } : { name, text };
        const answer = await validate(request, signal);
        if (!signal.aborted) dispatch({ type: 'checked', revision, answer });
      } catch (error) {
        if (!signal.aborted) {
          dispatch({
            type: 'check-failed',
            revision,
            message: messageOf(error),
          });
        }
      }
    };
    previous.current = previous.current.then(check).catch(() => undefined);
    return () => controller.abort();
  }, [text, revision]);

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
    edit,
  };
}
