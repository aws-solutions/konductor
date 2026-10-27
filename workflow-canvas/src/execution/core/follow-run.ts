// SPDX-License-Identifier: Apache-2.0
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : UNKNOWN_FAILURE;
}

/** What following a run needs: the ports and where events go. */
interface Watch {
  runs: RunPort;
  scheduler: Scheduler;
  /** Must not throw: a throw would be taken for a failure of the run. */
  emit: (event: ExecutionEvent) => void;
  /** Aborting stops the loop quietly: no further event is emitted. */
  signal: AbortSignal;
}

/** What `startAndFollow` needs: the ports, the goal and where events go. */
export interface FollowRequest extends Watch {
  goal: string;
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
  { runs, scheduler, signal }: Watch,
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

// Reads the run every poll interval until it is no longer running. `first` is
// a reading that the caller already has.
async function follow(
  request: Watch,
  runId: string,
  first?: RunView,
): Promise<void> {
  const { scheduler, emit, signal } = request;
  for (let known = first; ; known = undefined) {
    const run = known ?? (await read(request, runId));
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
    if (!signal.aborted) emit({ type: 'failed', message: messageOf(error) });
  }
}

/** What `resumeRun` needs: what `startAndFollow` does, and the run to join. */
export interface ResumeRequest extends Watch {
  runId: string;
}

/**
 * Joins the run `runId` if it is still running, as a page that was reloaded
 * does, and follows it like `startAndFollow`. A run that has ended, one that
 * cannot be read, or another run says nothing: there is nothing to resume.
 * It never rejects.
 */
export async function resumeRun(request: ResumeRequest): Promise<void> {
  const { runs, runId, emit, signal } = request;
  const run = await runs.get(runId).catch(() => undefined);
  if (signal.aborted || run?.runId !== runId || run.status !== 'running') {
    return;
  }
  emit({ type: 'start' });
  emit({ type: 'started', runId, joined: true });
  try {
    await follow(request, runId, run);
  } catch (error) {
    if (!signal.aborted) emit({ type: 'failed', message: messageOf(error) });
  }
}
