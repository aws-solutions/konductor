// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, {
  type StatusIndicatorProps,
} from '@cloudscape-design/components/status-indicator';
import { useMemo } from 'react';
import type { RunView, WorkflowView } from '../api/types';
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { LoadResult } from '../workflow/load-workflow';
import { WorkflowGate, type DrawableWorkflow } from '../workflow/WorkflowGate';
import {
  GOAL_MAX_LENGTH,
  goalProblem,
  isInFlight,
  isJoinedRun,
  nodeStatuses,
  runOf,
  stageDrift,
  statusKind,
  statusText,
  type ExecutionState,
  type StatusKind,
} from './core';
import './execution.css';
import { runErrorOf } from './run-error';
import type { ExecutionController } from './use-execution';

// Safari reports the Enter that commits a composition after it has ended, with
// `isComposing` false and the key code 229, so both are checked.
function isPlainEnter(key: InputProps.KeyDetail): boolean {
  return key.key === 'Enter' && !key.isComposing && key.keyCode !== 229;
}

const INDICATOR: Record<StatusKind, StatusIndicatorProps.Type> = {
  idle: 'pending',
  busy: 'in-progress',
  success: 'success',
  error: 'error',
};

// The sentence that says where the run is. A screen reader hears the same
// words from the live region that `RunAnnouncements` keeps outside the tabs.
function RunStatusLine({ state }: { state: ExecutionState }) {
  return (
    <div data-testid="run-status">
      <StatusIndicator type={INDICATOR[statusKind(state)]}>
        {statusText(state)}
      </StatusIndicator>
    </div>
  );
}

// The alert sits under the Run button, so it is next to the control that was
// pressed on a narrow screen too.
function RunError({ state }: { state: ExecutionState }) {
  const error = runErrorOf(state);
  if (!error) return null;
  return (
    <Alert type="error" header={error.header} data-testid="run-error">
      {error.message}
      {error.note && <div>{error.note}</div>}
    </Alert>
  );
}

// A run reads the saved file, which can change while it goes on, so its stages
// can differ from the graph, and then some nodes show no state.
function StageDriftNotice({
  view,
  run,
}: {
  view: WorkflowView;
  run: RunView | undefined;
}) {
  const drift = stageDrift(view, run);
  if (!drift) return null;
  const { notInGraph, notInRun } = drift;
  return (
    <Alert type="warning" data-testid="stage-drift">
      The stages of this run are not the stages in the graph, so some nodes show
      no state. The workflow file changed after this page loaded or after the
      run started. Reload the page to draw it.
      {notInGraph.length > 0 && ` Not drawn: ${notInGraph.join(', ')}.`}
      {notInRun.length > 0 && ` Not in the run: ${notInRun.join(', ')}.`}
    </Alert>
  );
}

// A run that was already going has a goal that the API does not give, and the
// box must not show another goal in its place.
const NO_GOAL_OF_JOINED_RUN =
  'This run was already going, so its goal is not known here.';

function RunPanel({
  goal,
  onGoalChange,
  execution,
}: {
  goal: string;
  onGoalChange: (goal: string) => void;
  execution: ExecutionController;
}) {
  const inFlight = isInFlight(execution.state);
  const joined = isJoinedRun(execution.state);
  const problem = goalProblem(goal);
  const canRun = !inFlight && problem === undefined;
  return (
    <Container header={<Header variant="h2">Run</Header>}>
      <SpaceBetween size="m">
        <FormField
          label="Goal"
          description={
            joined
              ? NO_GOAL_OF_JOINED_RUN
              : 'What the run should achieve. Every stage is given it.'
          }
          constraintText={`At most ${GOAL_MAX_LENGTH} characters.`}
          errorText={problem}
        >
          <Input
            value={joined ? '' : goal}
            placeholder={joined ? 'Not known' : undefined}
            readOnly={inFlight}
            onChange={({ detail }) => onGoalChange(detail.value)}
            onKeyDown={({ detail }) => {
              if (isPlainEnter(detail) && canRun) {
                execution.start(goal);
              }
            }}
          />
        </FormField>
        <Button
          variant="primary"
          disabled={!canRun}
          disabledReason={inFlight ? 'A run is in progress.' : problem}
          onClick={() => execution.start(goal)}
        >
          Run
        </Button>
        <RunStatusLine state={execution.state} />
        <RunError state={execution.state} />
      </SpaceBetween>
    </Container>
  );
}

function UnsavedNote() {
  return (
    <Alert type="info" data-testid="unsaved-note">
      The Designer has changes that are not saved. A run uses the saved
      workflow, which is the one drawn here.
    </Alert>
  );
}

function ExecutionView({
  workflow,
  goal,
  onGoalChange,
  execution,
  unsaved,
}: {
  workflow: DrawableWorkflow;
  goal: string;
  onGoalChange: (goal: string) => void;
  execution: ExecutionController;
  unsaved: boolean;
}) {
  const { view, harness } = workflow;
  const run = runOf(execution.state);
  const statuses = useMemo(() => nodeStatuses(run), [run]);
  return (
    <SpaceBetween size="m">
      {unsaved && <UnsavedNote />}
      <StageDriftNotice view={view} run={run} />
      <div className="wf-execution">
        <WorkflowGraphCard view={view} harness={harness} statuses={statuses} />
        <RunPanel
          goal={goal}
          onGoalChange={onGoalChange}
          execution={execution}
        />
      </div>
    </SpaceBetween>
  );
}

/**
 * The Execution tab: the workflow graph, read-only, a goal and a Run button,
 * and the live state of every node while the run goes on. `execution` holds
 * the state and `goal` the text of the Goal box, both kept by the caller, so a
 * run goes on and the goal stays while the Designer tab is open. The box is
 * read-only while a run is in flight, so it then shows the goal of that run.
 * `result` is the workflow as saved, which is what a run uses; `unsaved` says
 * that the Designer holds changes that it does not have.
 */
export function Execution({
  result,
  execution,
  goal,
  onGoalChange,
  unsaved = false,
}: {
  result: LoadResult | undefined;
  execution: ExecutionController;
  goal: string;
  onGoalChange: (goal: string) => void;
  unsaved?: boolean;
}) {
  return (
    <WorkflowGate result={result}>
      {(workflow) => (
        <ExecutionView
          workflow={workflow}
          goal={goal}
          onGoalChange={onGoalChange}
          execution={execution}
          unsaved={unsaved}
        />
      )}
    </WorkflowGate>
  );
}
