// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckAnswer, ValidatePort } from '../designer-view/yaml-draft';

const CHECK_FAILED = 'The text could not be checked.';

/** The answer for the text as loaded, and where that check is. */
export interface InitialCheck {
  /** The answer for the loaded text, once it has come. */
  readonly answer?: CheckAnswer;
  /** True while the check of the loaded text is in flight. */
  readonly reading: boolean;
  /** Why the check of the loaded text could not be made. */
  readonly failure?: string;
  /**
   * Asks for the check again after a `failure`, so one failed read does not
   * leave a person without the keys of a stage until the page is reloaded. It
   * does nothing while a check is in flight, once one has answered, or after
   * the view has gone.
   */
  checkAgain(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : CHECK_FAILED;
}

/**
 * Checks the workflow text as it was loaded, once, so the keys of a stage are
 * known before anything is edited. The draft of the YAML tab opens its text
 * unchecked on purpose, because nothing has changed yet; this reads the same
 * text through the same call, so a stage shows the prompt it has in the file.
 *
 * Another text, as another workflow or a save gives, starts again from it:
 * the check in flight is aborted, and so is the one of an unmounted view,
 * after which no state is set. One check is in flight at a time. A check
 * that could not be made is asked again by `checkAgain`, because without it
 * one lost read leaves every loaded stage refused by the save guard until
 * the page is reloaded.
 */
export function useInitialCheck({
  text,
  name,
  validate,
}: {
  /** The text as loaded, which is what a fresh check reads. */
  readonly text: string;
  /** The workflow the text is for, sent with the check. */
  readonly name?: string;
  /** Read when the check starts, so a new function each render is fine. */
  readonly validate: ValidatePort;
}): InitialCheck {
  const [checked, setChecked] = useState<{
    readonly text: string;
    readonly answer?: CheckAnswer;
    readonly failure?: string;
  }>();
  // Counts the asks for another check. It is part of the effect's key, so an
  // ask starts a fresh call under the same text.
  const [asked, setAsked] = useState(0);
  const latest = useRef(validate);
  const live = useRef(true);

  useEffect(() => {
    latest.current = validate;
  });

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const request = name === undefined ? { text } : { name, text };
    void latest
      .current(request, signal)
      .then((answer) => {
        if (!signal.aborted) setChecked({ text, answer });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          setChecked({ text, failure: messageOf(error) });
        }
      });
    return () => controller.abort();
  }, [text, name, asked]);

  const failed = checked?.text === text && checked.failure !== undefined;
  const checkAgain = useCallback(() => {
    if (!failed || !live.current) return;
    setAsked((was) => was + 1);
    setChecked(undefined);
  }, [failed]);

  if (checked?.text !== text) return { reading: true, checkAgain };
  return {
    reading: false,
    ...(checked.answer ? { answer: checked.answer } : {}),
    ...(checked.failure === undefined ? {} : { failure: checked.failure }),
    checkAgain,
  };
}
