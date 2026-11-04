// SPDX-License-Identifier: Apache-2.0
import { messageOf } from '../../api/message-of';
import type { RunView } from '../../api/types';
import type { ExecutionEvent } from './execution-state';
import {
  RunAlreadyActive,
  RunReadRefused,
  RunStartUnsure,
  type RunPort,
  type Scheduler,
} from './ports';

/** How long to wait between two reads of a run, as the API asks. */
export const POLL_INTERVAL_MS = 1000;

/** How many reads in a row may fail before the run is given up on. */
export const MAX_READ_FAILURES = 3;

const UNKNOWN_FAILURE = 'The run did not go as expected.';
const OTHER_RUN = 'The server answered with a run that is not the one started.';

/** What following a run needs: the ports and where events go. */
interface Watch {
  runs: RunPort;
  scheduler: Scheduler;
  /** Must not throw: a throw would be taken for a failure of the run. */
  emit: (event: ExecutionEvent) => void;
  /** Aborting stops the loop quietly: no further event is emitted. */
  signal: AbortSignal;
}

// The failure event of a loop. A start that got no clear answer says so.
function failure(
  error: unknown,
  runId: string | undefined,
): Extract<ExecutionEvent, { type: 'failed' }> {
  const failed = {
    type: 'failed',
    message: messageOf(error, UNKNOWN_FAILURE),
    runId,
  } as const;
  return error instanceof RunStartUnsure
    ? { ...failed, maybeStarted: true }
    : failed;
}

/**
 * What `startAndFollow` needs: the ports, the goal and where events go. The
 * caller runs one loop at a time: a failure with no run id is taken for the
 * failure of the start in progress.
 */
export interface FollowRequest extends Watch {
  goal: string;
}

// Starts a run, or names the run that is already active in its place.
async function begin({
  runs,
  goal,
  signal,
}: FollowRequest): Promise<{ runId: string; joined: boolean }> {
  try {
    return { runId: await runs.start(goal, signal), joined: false };
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
      return await runs.get(runId, signal);
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
      emit({ type: 'failed', message: OTHER_RUN, runId });
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
 * It does not reject unless `emit` throws, which `FollowRequest` forbids. A
 * failure ends the loop with one `failed` event, which names the run once
 * there is one, so it cannot be taken for another's.
 */
export async function startAndFollow(request: FollowRequest): Promise<void> {
  const { emit, signal } = request;
  let runId: string | undefined;
  try {
    const begun = await begin(request);
    runId = begun.runId;
    if (signal.aborted) return;
    emit(
      begun.joined
        ? { type: 'started', runId, joined: true }
        : { type: 'started', runId },
    );
    await follow(request, runId);
  } catch (error) {
    if (!signal.aborted) emit(failure(error, runId));
  }
}

/** What `resumeRun` needs: what `startAndFollow` does, and the run to join. */
export interface ResumeRequest extends Watch {
  runId: string;
}

// The look at the remembered run could not finish, so nobody knows whether it
// is going. Say so under the run, which the alert names.
function reportUnknownRun(
  { runId, emit }: ResumeRequest,
  error: unknown,
): void {
  emit({ type: 'start' });
  emit({ type: 'started', runId, joined: true });
  emit({ type: 'failed', message: messageOf(error, UNKNOWN_FAILURE), runId });
}

/**
 * Joins the run `runId` if it is still running, as a page that was reloaded
 * does, and follows it like `startAndFollow`. The first reading is tried
 * again like any other. A run that has ended, another run, or one that the
 * server will not give (it started again) says nothing: there is nothing to
 * resume. When the readings fail for any other reason, whether the run is
 * going is not known, and the failure is reported like a lost run. It never
 * rejects.
 */
export async function resumeRun(request: ResumeRequest): Promise<void> {
  const { runId, emit, signal } = request;
  let run: RunView | undefined;
  try {
    run = await read(request, runId);
  } catch (error) {
    if (!signal.aborted && !(error instanceof RunReadRefused)) {
      reportUnknownRun(request, error);
    }
    return;
  }
  if (signal.aborted || run?.runId !== runId || run.status !== 'running') {
    return;
  }
  emit({ type: 'start' });
  emit({ type: 'started', runId, joined: true });
  try {
    await follow(request, runId, run);
  } catch (error) {
    if (!signal.aborted) {
      emit({
        type: 'failed',
        message: messageOf(error, UNKNOWN_FAILURE),
        runId,
      });
    }
  }
}
