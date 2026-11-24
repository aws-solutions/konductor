// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { GOAL_MAX_LENGTH, goalProblem } from '../execution/core/goal';
import { RunFloor } from '../execution/RunFloor';
import type { ReasonSentence } from '../execution/core/stage-detail';
import { startsOnEnter } from './run-start';
import type { RunController } from './use-run-controller';

const NO_GOAL_OF_JOINED_RUN =
  'This run was already going, so its goal is not known here.';

const GOAL_DESCRIPTION =
  'What the run should achieve. Every stage is given it.';

function GoalPanel({
  goal,
  ofThisRun,
  touched,
  canStart,
  disabledReason,
  onGoal,
  onStart,
}: {
  goal: string;
  ofThisRun: boolean;
  /** Whether the person has typed a goal or asked for a run. */
  touched: boolean;
  canStart: boolean;
  disabledReason: string | undefined;
  onGoal: (goal: string) => void;
  onStart: () => void;
}) {
  // An untouched box of a workflow with no default goal is empty because
  // nothing has been typed yet, not because the person emptied it, so it is
  // not marked wrong. The disabled reason on Run already says a goal is
  // needed.
  const problem = touched ? goalProblem(goal) : undefined;
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
 * picked, and the past runs.
 *
 * It draws what `controller` holds and asks it to start a run; the run is
 * followed by the page, which keeps that controller whether this view is on
 * show or not, so a change of tab does not stop the only follower of a run.
 * The Goal box is read-only while a run that was already going is still
 * going, because the API does not give that run's goal. It adds no live
 * region: the run status is announced once, elsewhere on the page.
 */
export function RunView({
  controller,
  reasonSentence = () => undefined,
}: {
  /** Where the run is, and the ways to act on it, as the page holds them. */
  controller: RunController;
  /** The sentence for the reason code of a blocked stage. */
  reasonSentence?: ReasonSentence;
}) {
  const { follow, history, notice } = controller;
  return (
    <SpaceBetween size="m">
      <GoalPanel
        goal={controller.goal}
        ofThisRun={controller.ofThisRun}
        touched={controller.goalTouched}
        canStart={controller.canStart}
        disabledReason={controller.disabledReason}
        onGoal={controller.goalTyped}
        onStart={controller.startRun}
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
          action={
            <Button
              disabled={!controller.canFollowAgain}
              onClick={controller.followAgain}
            >
              Follow again
            </Button>
          }
        >
          {follow.status.message} The run may still be going on the server.
          Follow it again to read on from where this page stopped, or reload the
          page.
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
        run={controller.run}
        runId={controller.runId}
        progress={controller.progress}
        history={history.runs}
        ended={controller.ended}
        reasonSentence={reasonSentence}
      />
    </SpaceBetween>
  );
}
