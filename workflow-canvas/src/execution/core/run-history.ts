// SPDX-License-Identifier: Apache-2.0

/**
 * One run of `GET /api/runs`, the `RunSummary` of `api/openapi.yaml`. It is
 * local until the API client parses the run history.
 */
export interface RunSummaryRow {
  readonly run_id: string;
  /** A UTC time to the whole second, such as `2026-10-24T04:12:05Z`. */
  readonly started_at: string;
  readonly status: 'running' | 'passed' | 'halted';
  /** May be empty, for a run that took a workflow's empty default goal. */
  readonly goal: string;
  /** True when the server cut `goal`. */
  readonly goal_truncated: boolean;
}

/** The most runs the list shows, as the API sends at most 200. */
export const RUN_HISTORY_LIMIT = 200;

/**
 * The runs to list, newest first by `started_at`, at most
 * `RUN_HISTORY_LIMIT`. The sort is stable, so runs that started in the same
 * second keep the order the server gave, which is newest first too.
 */
export function historyRows(
  runs: readonly RunSummaryRow[],
): readonly RunSummaryRow[] {
  return [...runs]
    .sort((a, b) => compareText(b.started_at, a.started_at))
    .slice(0, RUN_HISTORY_LIMIT);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const STATE_WORDS: Readonly<Record<RunSummaryRow['status'], string>> = {
  running: 'Running',
  passed: 'Passed',
  halted: 'Halted',
};

/** The word for the state of a run. */
export function runStateWord(status: RunSummaryRow['status']): string {
  return STATE_WORDS[status];
}

/**
 * A start time as `2026-10-24 04:12:05 UTC`. A value that is not of the
 * contract's form is shown as it is.
 */
export function startedText(startedAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z$/.exec(startedAt);
  return match ? `${match[1]} ${match[2]} UTC` : startedAt;
}
