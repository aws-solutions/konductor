// SPDX-License-Identifier: Apache-2.0
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import { useMemo } from 'react';
import type { WorkflowView } from '../api/types';
import { buildGraph, withStatuses, type NodeStatus } from '../graph';
import { WorkflowCanvas } from './WorkflowCanvas';

const NO_STATUSES: ReadonlyMap<string, NodeStatus> = new Map();

/**
 * The card both tabs draw the workflow in: its name, then the read-only graph.
 * `statuses` puts a live state on the nodes it names, by node id.
 */
export function WorkflowGraphCard({
  view,
  harness,
  statuses = NO_STATUSES,
}: {
  view: WorkflowView;
  harness: string;
  statuses?: ReadonlyMap<string, NodeStatus>;
}) {
  const graph = useMemo(
    () => withStatuses(buildGraph(view, harness), statuses),
    [view, harness, statuses],
  );
  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Read-only. The stages run in the order they are listed."
        >
          Workflow: {view.name}
        </Header>
      }
    >
      <WorkflowCanvas graph={graph} />
    </Container>
  );
}
