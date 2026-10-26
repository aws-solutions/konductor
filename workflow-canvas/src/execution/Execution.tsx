// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, {
  type StatusIndicatorProps,
} from '@cloudscape-design/components/status-indicator';
import { useMemo, useState } from 'react';
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { LoadResult } from '../workflow/load-workflow';
import { WorkflowGate, type DrawableWorkflow } from '../workflow/WorkflowGate';
import {
  GOAL_MAX_LENGTH,
  goalProblem,
  isInFlight,
  nodeStatuses,
  runOf,
  statusKind,
  statusText,
  type ExecutionState,
  type StatusKind,
} from './core';
import './execution.css';
import type { Execution as ExecutionController } from './use-execution';

const INDICATOR: Record<StatusKind, StatusIndicatorProps.Type> = {
  idle: 'pending',
  busy: 'in-progress',
  success: 'success',
  error: 'error',
};

// One live region that says where the run is. It is always on the page, so a
// change of its text is announced.
function RunStatusLine({ state }: { state: ExecutionState }) {
  return (
    <div role="status" aria-live="polite" data-testid="run-status">
      <StatusIndicator type={INDICATOR[statusKind(state)]}>
        {statusText(state)}
      </StatusIndicator>
    </div>
  );
}

function RunError({ state }: { state: ExecutionState }) {
  if (state.phase !== 'error') return null;
  return (
    <Alert
      type="error"
      header={
        state.started
          ? 'The run could not be followed'
          : 'The run did not start'
      }
      data-testid="run-error"
    >
      {state.message}
    </Alert>
  );
}

function RunPanel({
  defaultGoal,
  execution,
}: {
  defaultGoal: string;
  execution: ExecutionController;
}) {
  const [goal, setGoal] = useState(defaultGoal);
  const inFlight = isInFlight(execution.state);
  const problem = goalProblem(goal);
  return (
    <Container header={<Header variant="h2">Run</Header>}>
      <SpaceBetween size="m">
        <FormField
          label="Goal"
          description="What the run should achieve. Every stage is given it."
          constraintText={`At most ${GOAL_MAX_LENGTH} characters.`}
          errorText={problem}
        >
          <Input
            value={goal}
            disabled={inFlight}
            onChange={({ detail }) => setGoal(detail.value)}
          />
        </FormField>
        <Button
          variant="primary"
          disabled={inFlight || problem !== undefined}
          disabledReason={inFlight ? 'A run is in progress.' : problem}
          onClick={() => execution.start(goal)}
        >
          Run
        </Button>
        <RunStatusLine state={execution.state} />
      </SpaceBetween>
    </Container>
  );
}

function ExecutionView({
  workflow,
  execution,
}: {
  workflow: DrawableWorkflow;
  execution: ExecutionController;
}) {
  const { view, harness } = workflow;
  const run = runOf(execution.state);
  const statuses = useMemo(() => nodeStatuses(run), [run]);
  return (
    <SpaceBetween size="l">
      <RunError state={execution.state} />
      <div className="wf-execution">
        <WorkflowGraphCard view={view} harness={harness} statuses={statuses} />
        <RunPanel defaultGoal={view.intent.outcome} execution={execution} />
      </div>
    </SpaceBetween>
  );
}

/**
 * The Execution tab: the workflow graph, read-only, a goal and a Run button,
 * and the live state of every node while the run goes on. `execution` holds
 * the state, so a run goes on while the Designer tab is open.
 */
export function Execution({
  result,
  execution,
}: {
  result: LoadResult | undefined;
  execution: ExecutionController;
}) {
  return (
    <WorkflowGate result={result}>
      {(workflow) => (
        <ExecutionView workflow={workflow} execution={execution} />
      )}
    </WorkflowGate>
  );
}
