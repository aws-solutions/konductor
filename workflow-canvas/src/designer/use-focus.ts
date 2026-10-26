// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Something that can take keyboard focus, such as a Cloudscape input. */
export interface Focusable {
  focus(): void;
}

/**
 * Returns a function that asks for `target` to take focus. The focus moves
 * after the next render, when the control is on the page and shows the change
 * that the request goes with.
 */
export function useFocusRequest(
  target: RefObject<Focusable | null>,
): () => void {
  const requested = useRef(false);
  useEffect(() => {
    if (!requested.current) return;
    requested.current = false;
    target.current?.focus();
  });
  return useCallback(() => {
    requested.current = true;
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
