// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState } from 'react';
import { GOAL_MAX_LENGTH, goalProblem } from '../execution/core/goal';
import type { RunMemory, RunPort, Scheduler } from '../execution/core/ports';
import { RunFloor } from '../execution/RunFloor';
import { progressText, runProgress } from '../execution/core/run-progress';
import type { ReasonSentence } from '../execution/core/stage-detail';

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
  startsOnEnter,
  type GoalSource,
  type RunLifecycle,
} from './run-start';
import { runTiming } from './run-timing';
import { useRunClock } from './use-run-clock';
import { useRunHistory, type ListRuns } from './use-run-history';
import { useRunStart } from './use-run-start';

/** The calls of the session that the Run view makes. */
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

const NO_GOAL_OF_JOINED_RUN =
  'This run was already going, so its goal is not known here.';

const GOAL_DESCRIPTION =
  'What the run should achieve. Every stage is given it.';

// The sentence of a follow that ended badly, for the live region.
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

function GoalPanel({
  goal,
  ofThisRun,
  canStart,
  disabledReason,
  onGoal,
  onStart,
}: {
  goal: string;
  ofThisRun: boolean;
  canStart: boolean;
  disabledReason: string | undefined;
  onGoal: (goal: string) => void;
  onStart: () => void;
}) {
  const problem = goalProblem(goal);
  return (
    <Container header={<Header variant="h2">Run</Header>}>
      <SpaceBetween size="m">
        <FormField
          label="Goal"
          description={ofThisRun ? GOAL_DESCRIPTION : NO_GOAL_OF_JOINED_RUN}
          constraintText={`At most ${GOAL_MAX_LENGTH} characters.`}
          errorText={ofThisRun ? problem : undefined}
        >
          <Input
            value={ofThisRun ? goal : ''}
            placeholder={ofThisRun ? undefined : 'Not known'}
            readOnly={!ofThisRun}
            onChange={({ detail }) => onGoal(detail.value)}
            onKeyDown={({ detail }) => {
              if (startsOnEnter(detail) && canStart) onStart();
            }}
          />
        </FormField>
        <Button
          variant="primary"
          disabled={!canStart}
          disabledReason={disabledReason}
          onClick={onStart}
        >
          Run
        </Button>
      </SpaceBetween>
    </Container>
  );
}

/**
 * The Run view: a Goal box with the workflow's default goal in it, a Run
 * button, how far the run has got, its stages with the console of the one
 * picked, and the past runs. It follows the run through the events of the
 * session and starts runs through the session's own call; it holds no token.
 * The Goal box is read-only while a run that was already going is still
 * going, because the API does not give that run's goal. A run that has ended,
 * or one that cannot be followed any more, is dropped from the kept session,
 * so a reload does not take it up again. It adds no live region: the run
 * status is announced once, elsewhere on the page.
 */
export function RunView({
  stages,
  goalDefault,
  ports,
  runMemory,
  onRunState,
  reasonSentence = () => undefined,
}: {
  /** The stages of the workflow, in run order. */
  stages: readonly string[];
  /** The `params.goal.default` of the workflow, when it declares one. */
  goalDefault?: string;
  ports: RunViewPorts;
  /** Keeps the run across a reload; a page without it starts afresh. */
  runMemory?: RunMemory;
  /**
   * Told where the run is whenever that changes, so the page can guard a
   * workflow swap and announce the run in the one live region it keeps.
   */
  onRunState?: (state: RunLifecycle) => void;
  /** The sentence for the reason code of a blocked stage. */
  reasonSentence?: ReasonSentence;
}) {
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
  const setTyped = (text: string) =>
    setTypedFor({ source: goalSource, typed: text });
  const { start, begin, forget } = useRunStart({
    port: { start: ports.start },
    ...(runMemory ? { memory: runMemory } : {}),
  });
  const runId = followedRunId(start);
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
    start,
    runFinished,
    goalProblem: goalProblem(goal),
  };
  const canStart = canStartRun(decision);
  const notice = startNotice(start);
  const timing = runTiming(runId ?? '', history.runs, seen?.at ?? ports.now());
  const progress = run
    ? runProgress(run, timing, () => clockNow, {
        ended: status === 'finished',
      })
    : undefined;
  // What the page outside this view needs: whether a run would be lost, and
  // the sentences for the one live region it keeps.
  const lifecycle: RunLifecycle = {
    active:
      (start.kind === 'starting' || start.kind === 'going') && !runFinished,
    status: progress ? progressText(progress) : '',
    ...(notice ? { error: `${notice.header} ${notice.message}` } : {}),
    ...(follow.status.kind === 'failed' || gone
      ? { error: followMessage(follow) }
      : {}),
  };
  const told = useRef<string>(undefined);
  useEffect(() => {
    const said = JSON.stringify(lifecycle);
    if (told.current === said) return;
    told.current = said;
    onRunState?.(lifecycle);
  });
  return (
    <SpaceBetween size="m">
      <GoalPanel
        goal={goal}
        ofThisRun={goalIsOfThisRun(start, runFinished)}
        canStart={canStart}
        disabledReason={startDisabledReason(decision)}
        onGoal={setTyped}
        onStart={() => begin(goal)}
      />
      {notice && (
        <Alert
          type="error"
          header={notice.header}
          data-testid="run-start-error"
        >
          {notice.message}
        </Alert>
      )}
      {follow.status.kind === 'failed' && (
        <Alert
          type="error"
          header="The run is no longer followed."
          data-testid="run-follow-error"
        >
          {follow.status.message}
        </Alert>
      )}
      {follow.status.kind === 'session_lost' && (
        <Alert
          type="error"
          header="The server no longer knows this session."
          data-testid="run-session-error"
        >
          {follow.status.message}
        </Alert>
      )}
      {history.failure !== undefined && (
        <Alert type="warning" data-testid="run-history-error">
          {history.failure}
        </Alert>
      )}
      <RunFloor
        run={run}
        progress={progress}
        history={history.runs}
        ended={status === 'finished'}
        reasonSentence={reasonSentence}
      />
    </SpaceBetween>
  );
}
