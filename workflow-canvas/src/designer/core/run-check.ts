// SPDX-License-Identifier: Apache-2.0
import type { Scheduler } from '../../execution/core';
import type { EditEvent } from './edit-state';
import type { EditPort } from './ports';

/**
 * How long the text must stay unchanged before it is checked, so a name being
 * typed is checked once and not at each key.
 */
export const CHECK_DELAY_MS = 400;

/** What `checkAfterPause` needs: the port, the text and where events go. */
export interface CheckRequest {
  edits: EditPort;
  scheduler: Scheduler;
  text: string;
  /** The revision of the draft that the text is written from. */
  revision: number;
  emit: (event: EditEvent) => void;
  /** Aborting stops it quietly: no call is made and nothing is emitted. */
  signal: AbortSignal;
}

/**
 * Waits for `CHECK_DELAY_MS`, then checks the text and tells `emit` what the
 * check found. It never rejects. A check that fails to run says nothing: the
 * save checks the text again and reports that.
 */
export async function checkAfterPause(request: CheckRequest): Promise<void> {
  const { edits, scheduler, text, revision, emit, signal } = request;
  await scheduler.wait(CHECK_DELAY_MS, signal);
  if (signal.aborted) return;
  try {
    const { diagnostics } = await edits.check(text);
    if (!signal.aborted) emit({ type: 'checked', revision, diagnostics });
  } catch {
    // Left to the save, as the doc comment says.
  }
}
