// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import { goalProblem } from '../execution/core/goal';
import type { RunMemory, RunPort, Scheduler } from '../execution/core/ports';
import {
  progressText,
  runProgress,
  type RunProgress,
} from '../execution/core/run-progress';
import type { FollowedRun } from '../execution/core/run-follow';
import type { ReadEvents } from '../run-client/follow-run-events';
import {
  useFollowRun,
  type FollowRunState,
} from '../run-client/use-follow-run';
import {
  canStartRun,
  followedRunId,
  goalIsOfThisRun,
  goalText,
  sameGoalSource,
  startDisabledReason,
  startNotice,
  type GoalSource,
  type RunLifecycle,
  type StartNotice,
} from './run-start';
import { runTiming } from './run-timing';
import { useRunClock } from './use-run-clock';
import {
  useRunHistory,
  type ListRuns,
  type RunHistoryState,
} from './use-run-history';
import { useRunStart } from './use-run-start';

/** The calls of the session that following a run makes. */
export interface RunViewPorts {
  /** Starts a run, as `POST /api/run` does. */
  readonly start: RunPort['start'];
  /** Reads the events of a run; `undefined` without a session. */
  readonly readEvents: ReadEvents | undefined;
  /** Lists the past runs; `undefined` without a session. */
  readonly listRuns: ListRuns | undefined;
  /** Waits between the reads of a run. */
  readonly scheduler: Scheduler;
  /** The time now, in milliseconds. */
  readonly now: () => number;
}

/** Where the run is, and the ways to act on it, for a view to draw. */
export interface RunController {
  /** The text of the Goal box. */
  readonly goal: string;
  /** Whether that text is the goal of the run being followed. */
  readonly ofThisRun: boolean;
  readonly canStart: boolean;
  /** Why a run cannot be started, for the button to say. */
  readonly disabledReason: string | undefined;
  /** What went wrong with a start, for the alert under the button. */
  readonly notice: StartNotice | undefined;
  /** Where the follower of the run is. */
  readonly follow: FollowRunState;
  /** The run as its events have it, once there is one. */
  readonly run: FollowedRun | undefined;
  /** The past runs, and why they could not be read. */
  readonly history: RunHistoryState;
  /** How far the run has got, once there is a run. */
  readonly progress: RunProgress | undefined;
  /** Whether the run has ended, which the stages and the console say too. */
  readonly ended: boolean;
  /**
   * What the page outside the view needs: whether a run would be lost, and
   * the sentences for the one live region it keeps.
   */
  readonly lifecycle: RunLifecycle;
  /** Takes the text of the Goal box. */
  goalTyped(text: string): void;
  /** Starts a run with the goal in the box. */
  startRun(): void;
}

// The sentence of a follow that ended badly, for the live region. The view
// says which of the two it is in the header of its alert; the live region has
// one sentence to say it in, so it carries that word itself.
function followMessage(follow: FollowRunState): string {
  const { status } = follow;
  if (status.kind === 'failed') {
    return `The run is no longer followed. ${status.message}`;
  }
  if (status.kind === 'session_lost') {
    return `The server no longer knows this session. ${status.message}`;
  }
  return '';
}

/**
 * Follows a run of one workflow: the state of a start, the events of the run,
 * the past runs and the clock of the elapsed time, with the ways to type a
 * goal and start a run.
 *
 * The page holds this, not the view that draws it, so a run goes on while a
 * person looks at something else: the only follower of a run must not be
 * taken off the page by a change of tab. `ports` are the calls of one
 * workflow, so another workflow is another `ports` object, and the state
 * here starts again for it, the run its session kept included. Ports whose
 * reads are `undefined` are a page with no session: nothing is read.
 */
export function useRunController({
  stages,
  goalDefault,
  ports,
  runMemory,
}: {
  /** The stages of the workflow, in run order. */
  readonly stages: readonly string[];
  /** The `params.goal.default` of the workflow, when it declares one. */
  readonly goalDefault?: string;
  readonly ports: RunViewPorts;
  /** Keeps the run across a reload; a page without it starts afresh. */
  readonly runMemory?: RunMemory;
}): RunController {
  // The text a person types belongs to the workflow it was typed for, so
  // another workflow starts from its own default goal.
  const goalSource: GoalSource = {
    start: ports.start,
    list: ports.listRuns,
    goalDefault,
  };
  const [typedFor, setTypedFor] = useState<{
    source: GoalSource;
    typed: string;
  }>();
  const typed = sameGoalSource(typedFor?.source, goalSource)
    ? typedFor?.typed
    : undefined;
  const goal = goalText(typed, goalDefault);
  const {
    start: started,
    begin,
    forget,
  } = useRunStart({
    port: { start: ports.start },
    ...(runMemory ? { memory: runMemory } : {}),
  });
  const runId = followedRunId(started);
  const follow = useFollowRun({
    readEvents: ports.readEvents,
    scheduler: ports.scheduler,
    now: ports.now,
    runId,
    order: stages,
  });
  const run = follow.run;
  const status = follow.status.kind;
  // The follower has its own finished state: the server can report a run as
  // over in a read that brings no `run_finished` event, and the run has then
  // ended all the same.
  const runFinished = status === 'finished' || run?.outcome !== undefined;
  const ended = status === 'finished' || status === 'failed';
  const gone = status === 'session_lost';
  const history = useRunHistory({
    list: ports.listRuns,
    reread: `${runId ?? ''}:${runFinished ? 'ended' : status}`,
  });
  // A run that has ended, or one that cannot be followed any more, must not
  // be taken up again by a reload. What the view shows is left as it is.
  useEffect(() => {
    if (runId !== undefined && (ended || gone)) forget();
  }, [runId, ended, gone, forget]);
  // When each run was first followed, so the progress strip can time a run
  // that the list of past runs does not name yet.
  const [seen, setSeen] = useState<{ runId: string; at: number }>();
  if (runId !== undefined && seen?.runId !== runId) {
    setSeen({ runId, at: ports.now() });
  }
  const clockNow = useRunClock({
    scheduler: ports.scheduler,
    now: ports.now,
    ticking: status === 'following' && !runFinished,
  });
  const decision = {
    start: started,
    runFinished,
    goalProblem: goalProblem(goal),
  };
  const timing = runTiming(runId ?? '', history.runs, seen?.at ?? ports.now());
  const progress = run
    ? runProgress(run, timing, () => clockNow, {
        ended: status === 'finished',
      })
    : undefined;
  const notice = startNotice(started);
  // A start whose outcome is unknown counts as a run at risk: the server may
  // have taken it, and this page is the only one that could pick it up again,
  // so it must still warn before it swaps the workflow away.
  const atRisk =
    started.kind === 'starting' ||
    started.kind === 'going' ||
    started.kind === 'unsure';
  const lifecycle: RunLifecycle = {
    active: atRisk && !runFinished,
    status: progress ? progressText(progress) : '',
    ...(notice ? { error: `${notice.header} ${notice.message}` } : {}),
    ...(follow.status.kind === 'failed' || gone
      ? { error: followMessage(follow) }
      : {}),
  };
  return {
    goal,
    ofThisRun: goalIsOfThisRun(started, runFinished),
    canStart: canStartRun(decision),
    disabledReason: startDisabledReason(decision),
    notice,
    follow,
    run,
    history,
    progress,
    ended: status === 'finished',
    lifecycle,
    goalTyped: (text) => setTypedFor({ source: goalSource, typed: text }),
    startRun: () => begin(goal),
  };
}
