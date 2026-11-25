// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import type { ParamDeclaration } from '../api/workflow-extras';
import { goalProblem } from '../execution/core/goal';
import type { RunMemory, Scheduler } from '../execution/core/ports';
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
  paramBoxes,
  paramsProblem,
  runParams,
  withParam,
  type ParamBox,
  type ParamTexts,
  type StartRun,
} from './run-params';
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
  /** Starts a run with its params, as `POST /api/run` does. */
  readonly start: StartRun;
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
  /** One box per param the workflow declares, in the order of the file. */
  readonly params: readonly ParamBox[];
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
  /** The id of the run being followed, so a view can key its state on it. */
  readonly runId: string | undefined;
  /**
   * Whether the person has typed a goal or asked for a run, so the Goal box
   * holds back its error until then.
   */
  readonly goalTouched: boolean;
  /**
   * Whether the follower gave up, so the run can be followed again. The run
   * may still be going on the server, which is why Run stays disabled.
   */
  readonly canFollowAgain: boolean;
  /**
   * What the page outside the view needs: whether a run would be lost, and
   * the sentences for the one live region it keeps.
   */
  readonly lifecycle: RunLifecycle;
  /** Takes the text of the Goal box. */
  goalTyped(text: string): void;
  /** Takes the text of one param box. */
  paramTyped(name: string, text: string): void;
  /** Starts a run with the goal and the params in the boxes. */
  startRun(): void;
  /**
   * Follows the run again from where the reads stopped. It does nothing
   * unless `canFollowAgain`.
   */
  followAgain(): void;
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

/** No declared params, and no typed text, as one object for every render. */
const NO_PARAMS: readonly ParamDeclaration[] = [];
const NO_TEXTS: ParamTexts = {};

// What a person has typed for one workflow: the goal, if they typed one, and
// the text of each param box they typed into.
interface Typed {
  readonly source: GoalSource;
  readonly goal?: string;
  readonly params: ParamTexts;
}

/**
 * Follows a run of one workflow: the state of a start, the events of the run,
 * the past runs and the clock of the elapsed time, with the ways to type a
 * goal, fill in the declared params and start a run.
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
  declaredParams = NO_PARAMS,
  ports,
  runMemory,
}: {
  /** The stages of the workflow, in run order. */
  readonly stages: readonly string[];
  /** The `params.goal.default` of the workflow, when it declares one. */
  readonly goalDefault?: string;
  /** The params the workflow declares beside the goal, in the order of the file. */
  readonly declaredParams?: readonly ParamDeclaration[];
  readonly ports: RunViewPorts;
  /** Keeps the run across a reload; a page without it starts afresh. */
  readonly runMemory?: RunMemory;
}): RunController {
  // The text a person types belongs to the workflow it was typed for, so
  // another workflow starts from its own default goal and param defaults.
  const goalSource: GoalSource = {
    start: ports.start,
    list: ports.listRuns,
    goalDefault,
    declared: declaredParams,
  };
  const [typedFor, setTypedFor] = useState<Typed>();
  const own = sameGoalSource(typedFor?.source, goalSource)
    ? typedFor
    : undefined;
  const goal = goalText(own?.goal, goalDefault);
  const params = paramBoxes(declaredParams, own?.params ?? NO_TEXTS);
  const typeInto = (change: (held: Typed) => Typed) =>
    setTypedFor((held) =>
      change(
        sameGoalSource(held?.source, goalSource) && held
          ? held
          : { source: goalSource, params: NO_TEXTS },
      ),
    );
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
    paramsProblem: paramsProblem(params),
    followFailed: status === 'failed',
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
  // A follow that ended badly follows nothing: the reads have stopped and the
  // kept run id is dropped, so no swap warning could save the run. A person
  // who wants it back presses Follow again, which the view offers, or reloads;
  // warning about a lost run on the way out would only talk them out of the
  // very thing that gets them going again.
  const unfollowed = status === 'failed' || gone;
  const lifecycle: RunLifecycle = {
    active: atRisk && !runFinished && !unfollowed,
    status: progress ? progressText(progress) : '',
    ...(notice ? { error: `${notice.header} ${notice.message}` } : {}),
    ...(follow.status.kind === 'failed' || gone
      ? { error: followMessage(follow) }
      : {}),
  };
  return {
    goal,
    params,
    ofThisRun: goalIsOfThisRun(started, runFinished),
    canStart: canStartRun(decision),
    disabledReason: startDisabledReason(decision),
    notice,
    follow,
    run,
    history,
    progress,
    ended: status === 'finished',
    runId,
    goalTouched: own?.goal !== undefined || started.kind !== 'idle',
    canFollowAgain: status === 'failed',
    lifecycle,
    goalTyped: (text) => typeInto((held) => ({ ...held, goal: text })),
    paramTyped: (name, text) =>
      typeInto((held) => ({
        ...held,
        params: withParam(held.params, name, text),
      })),
    startRun: () => begin(runParams(goal, params)),
    followAgain: follow.retry,
  };
}
