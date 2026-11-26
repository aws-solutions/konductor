// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import type { CheckStates, ReadChecks } from '../execution/core/run-checks';

/** The states as last read, and why the last read failed when it did. */
export interface RunChecksState {
  readonly states: CheckStates;
  /** Why the last read failed; the states then stay as they were. */
  readonly failure?: string;
}

const NONE: RunChecksState = { states: {} };

const READ_FAILED = 'The checks of this run could not be read.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : READ_FAILED;
}

// What the states were read through, so the checks of one run are never
// shown under another.
interface Read extends RunChecksState {
  readonly read: ReadChecks;
  readonly runId: string;
}

/**
 * Reads the state of each check of the run, and again whenever `reread`
 * changes, which is as each stage passes and when the run ends. A read in
 * flight is aborted by the next one and by unmounting, and no state is set
 * after that. A failed read keeps the states read before it for the same run;
 * another run, or another session, starts from none.
 *
 * It reads nothing without a run id, so a page with no run makes no call.
 */
export function useRunChecks({
  read,
  runId,
  reread,
}: {
  /** `undefined` without a session, which reads nothing. */
  readonly read: ReadChecks | undefined;
  /** The run to read, or `undefined` when there is none. */
  readonly runId: string | undefined;
  /** Any value that, when it changes, asks for a fresh read. */
  readonly reread?: unknown;
}): RunChecksState {
  const [held, setHeld] = useState<Read>();

  useEffect(() => {
    if (read === undefined || runId === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    void read(runId, signal)
      .then((states) => {
        if (!signal.aborted) setHeld({ read, runId, states });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setHeld((was) => ({
          read,
          runId,
          states: was?.read === read && was.runId === runId ? was.states : {},
          failure: messageOf(error),
        }));
      });
    return () => controller.abort();
  }, [read, runId, reread]);

  if (read === undefined || runId === undefined) return NONE;
  if (held?.read !== read || held.runId !== runId) return NONE;
  return held.failure === undefined
    ? { states: held.states }
    : { states: held.states, failure: held.failure };
}
