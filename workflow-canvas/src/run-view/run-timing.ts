// SPDX-License-Identifier: Apache-2.0
import type { RunSummaryRow } from '../execution/core/run-history';
import { timestampMs } from '../execution/core/timestamp';
import type { RunTiming } from '../execution/core/run-progress';

/**
 * When the run `runId` started, for the progress strip: the `started_at`
 * that `GET /api/runs` gives for it, or `firstSeen`, the time the page began
 * to follow it, when the list does not have the run or its time cannot be
 * read. A run the page started has `firstSeen` within a moment of its real
 * start; a run from before a reload gets its time from the list.
 */
export function runTiming(
  runId: string,
  runs: readonly RunSummaryRow[],
  firstSeen: number,
): RunTiming {
  const row = runs.find((run) => run.run_id === runId);
  const startedAt = row === undefined ? undefined : timestampMs(row.started_at);
  return { startedAt: startedAt ?? firstSeen };
}
