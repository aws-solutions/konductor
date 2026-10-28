// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Something that can take keyboard focus, such as a Cloudscape input. */
export interface Focusable {
  focus(): void;
  /** Selects all the text, as an input does. */
  select?(): void;
}

/** What a focus request asks for besides focus. */
export interface FocusOptions {
  /** Select the text too, so that typing replaces it. */
  select?: boolean;
}

/**
 * Returns a function that asks for `target` to take focus, and with `select`
 * to select its text. The focus moves after the next render, when the control
 * is on the page and shows the change that the request goes with.
 */
export function useFocusRequest(
  target: RefObject<Focusable | null>,
): (options?: FocusOptions) => void {
  const requested = useRef<FocusOptions>(undefined);
  useEffect(() => {
    const request = requested.current;
    if (!request) return;
    requested.current = undefined;
    target.current?.focus();
    if (request.select) target.current?.select?.();
  });
  return useCallback((options: FocusOptions = {}) => {
    requested.current = options;
  }, []);
}

/**
 * Moves focus to `target` when `busy` goes from true to false and `done` is
 * true: for a control that disappears when its work ends, such as the button
 * of an alert that the work clears.
 */
export function useFocusWhenDone(
  target: RefObject<Focusable | null>,
  busy: boolean,
  done: boolean,
): void {
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && done) target.current?.focus();
    wasBusy.current = busy;
  }, [target, busy, done]);
}
