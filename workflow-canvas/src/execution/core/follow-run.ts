// SPDX-License-Identifier: Apache-2.0
import { messageOf } from '../../api/message-of';
import type { RunView } from '../../api/types';
import type { ExecutionEvent } from './execution-state';
import {
  RunAlreadyActive,
  RunReadRefused,
  type RunPort,
  type Scheduler,
} from './ports';

/** How long to wait between two reads of a run, as the API asks. */
export const POLL_INTERVAL_MS = 1000;

/** How many reads in a row may fail before the run is given up on. */
export const MAX_READ_FAILURES = 3;

const UNKNOWN_FAILURE = 'The run did not go as expected.';
const OTHER_RUN = 'The server answered with a run that is not the one started.';

/** What `startAndFollow` needs: the ports, the goal and where events go. */
export interface FollowRequest {
  runs: RunPort;
  scheduler: Scheduler;
  goal: string;
  emit: (event: ExecutionEvent) => void;
  /** Aborting stops the loop quietly: no further event is emitted. */
  signal: AbortSignal;
}

// Starts a run, or names the run that is already active in its place.
async function begin(
  runs: RunPort,
  goal: string,
): Promise<{ runId: string; joined: boolean }> {
  try {
    return { runId: await runs.start(goal), joined: false };
  } catch (error) {
    if (error instanceof RunAlreadyActive) {
      return { runId: error.runId, joined: true };
    }
    throw error;
  }
}

// One reading of the run. A failed read is tried again after a poll interval
// until `MAX_READ_FAILURES` in a row have failed; then the last error is thrown.
// A refused read is thrown at once, as trying again cannot change the answer.
async function read(
  { runs, scheduler, signal }: FollowRequest,
  runId: string,
): Promise<RunView | undefined> {
  for (let failures = 1; ; failures += 1) {
    try {
      return await runs.get(runId);
    } catch (error) {
      if (
        signal.aborted ||
        error instanceof RunReadRefused ||
        failures >= MAX_READ_FAILURES
      ) {
        throw error;
      }
      await scheduler.wait(POLL_INTERVAL_MS, signal);
      if (signal.aborted) return undefined;
    }
  }
}

async function follow(request: FollowRequest, runId: string): Promise<void> {
  const { scheduler, emit, signal } = request;
  for (;;) {
    const run = await read(request, runId);
    if (signal.aborted || run === undefined) return;
    if (run.runId !== runId) {
      emit({ type: 'failed', message: OTHER_RUN });
      return;
    }
    emit({ type: 'snapshot', run });
    if (run.status !== 'running') return;
    await scheduler.wait(POLL_INTERVAL_MS, signal);
    if (signal.aborted) return;
  }
}

/**
 * Starts a run, or joins the one that is already active, then reads it every
 * `POLL_INTERVAL_MS` until it is no longer running, telling `emit` each step.
 * It never rejects: a failure ends the loop with one `failed` event.
 */
export async function startAndFollow(request: FollowRequest): Promise<void> {
  const { runs, goal, emit, signal } = request;
  try {
    const { runId, joined } = await begin(runs, goal);
    if (signal.aborted) return;
    emit(
      joined ? { type: 'started', runId, joined } : { type: 'started', runId },
    );
    await follow(request, runId);
  } catch (error) {
    if (!signal.aborted)
      emit({ type: 'failed', message: messageOf(error, UNKNOWN_FAILURE) });
  }
}
