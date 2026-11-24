// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import type { RunSummaryRow } from '../execution/core/run-history';

/**
 * Lists the runs of the workflow, as `GET /api/runs` does, newest first or
 * in any order. It must reject when its signal aborts, as `fetch` does.
 */
export type ListRuns = (
  signal: AbortSignal,
) => Promise<readonly RunSummaryRow[]>;

/** The past runs as last read, and why the read failed when it did. */
export interface RunHistoryState {
  readonly runs: readonly RunSummaryRow[];
  /** Why the last read failed; the runs then stay as they were. */
  readonly failure?: string;
}

const EMPTY: RunHistoryState = { runs: [] };

const READ_FAILED = 'The past runs could not be read.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : READ_FAILED;
}

// What the rows were read through, so the runs of another workflow are not
// shown while its first read is still in flight.
interface Read extends RunHistoryState {
  readonly list: ListRuns;
}

/**
 * Reads the past runs once, and again whenever `reread` changes, such as
 * when a run ends. A read in flight is aborted by the next one and by
 * unmounting, and no state is set after that. A failed read keeps the runs
 * that were read before it, through the same `list`; a new `list` is another
 * session, so its rows are empty until it answers.
 */
export function useRunHistory({
  list,
  reread = 0,
}: {
  /** `undefined` without a session, which lists nothing. */
  readonly list: ListRuns | undefined;
  /** Any value that, when it changes, asks for a fresh read. */
  readonly reread?: unknown;
}): RunHistoryState {
  const [read, setRead] = useState<Read>();
  const latest = useRef(list);

  useEffect(() => {
    latest.current = list;
  });

  useEffect(() => {
    if (list === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    void list(signal)
      .then((runs) => {
        if (!signal.aborted) setRead({ list, runs });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setRead((was) => ({
          list,
          runs: was?.list === list ? was.runs : [],
          failure: messageOf(error),
        }));
      });
    return () => controller.abort();
  }, [list, reread]);

  if (list === undefined || read?.list !== list) return EMPTY;
  return read.failure === undefined
    ? { runs: read.runs }
    : { runs: read.runs, failure: read.failure };
}
