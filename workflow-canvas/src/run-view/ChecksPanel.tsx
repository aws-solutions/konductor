// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { CheckState } from '../execution/CheckState';
import type { CheckRow } from '../execution/core/run-checks';
import '../execution/run-checks.css';

const DEFERRED_MEANS =
  'Deferred means the run has not checked it yet. Verified means it has.';

function waitingStages(stages: readonly string[]): string {
  if (stages.length === 0) return 'No stage waits for it.';
  return `${stages.length === 1 ? 'Stage' : 'Stages'} ${stages.join(', ')}`;
}

/**
 * The checks the workflow declares, with the state the run reports for each
 * and the stages whose `done_when` waits for it. It draws nothing for a
 * workflow that declares no check, and adds no live region: a change of state
 * follows a stage passing, which the run status announces already.
 */
export function ChecksPanel({
  checks,
  failure,
}: {
  readonly checks: readonly CheckRow[];
  /** Why the states could not be read; the states shown are the last ones. */
  readonly failure?: string | undefined;
}) {
  if (checks.length === 0) return null;
  return (
    <Container
      header={
        <Header variant="h2" description={DEFERRED_MEANS}>
          Checks
        </Header>
      }
    >
      <SpaceBetween size="s">
        {failure && (
          <Alert type="warning" data-testid="run-checks-error">
            {failure}
          </Alert>
        )}
        <ul className="wf-checks-list" role="list">
          {checks.map((check) => (
            <li className="wf-checks-row" key={check.id}>
              <span className="wf-checks-id">{check.id}</span>
              <span className="wf-checks-stages">
                {waitingStages(check.stages)}
              </span>
              <CheckState check={check} />
            </li>
          ))}
        </ul>
      </SpaceBetween>
    </Container>
  );
}
