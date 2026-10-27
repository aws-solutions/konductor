// SPDX-License-Identifier: Apache-2.0
import type { ExecutionEvent } from './execution-state';
import type { RunPort, Scheduler } from './ports';

/** How long to wait between two reads of a run, as the API asks. */
export const POLL_INTERVAL_MS = 1000;

const UNKNOWN_FAILURE = 'The run did not go as expected.';
const OTHER_RUN = 'The server answered with a run that is not the one started.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : UNKNOWN_FAILURE;
}

/** What `startAndFollow` needs: the ports, the goal and where events go. */
export interface FollowRequest {
  runs: RunPort;
  scheduler: Scheduler;
  goal: string;
  /** Must not throw: a throw would be taken for a failure of the run. */
  emit: (event: ExecutionEvent) => void;
  /** Aborting stops the loop quietly: no further event is emitted. */
  signal: AbortSignal;
}

/**
 * Starts a run, then reads it every `POLL_INTERVAL_MS` until it is no longer
 * running, telling `emit` each step. It never rejects: a failed call ends the
 * loop with one `failed` event.
 */
export async function startAndFollow(request: FollowRequest): Promise<void> {
  const { runs, scheduler, goal, emit, signal } = request;
  try {
    const runId = await runs.start(goal);
    if (signal.aborted) return;
    emit({ type: 'started', runId });
    for (;;) {
      const run = await runs.get(runId);
      if (signal.aborted) return;
      if (run.runId !== runId) {
        emit({ type: 'failed', message: OTHER_RUN });
        return;
      }
      emit({ type: 'snapshot', run });
      if (run.status !== 'running') return;
      await scheduler.wait(POLL_INTERVAL_MS, signal);
      if (signal.aborted) return;
    }
  } catch (error) {
    if (!signal.aborted) emit({ type: 'failed', message: messageOf(error) });
  }
}
