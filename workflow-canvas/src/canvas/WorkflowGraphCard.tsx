// SPDX-License-Identifier: Apache-2.0
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useMemo, type ReactNode } from 'react';
import type { WorkflowSpec } from '../graph';
import { buildGraph, withStatuses, type NodeStatus } from '../graph';
import { WorkflowCanvas, type CanvasSelection } from './WorkflowCanvas';

const NO_STATUSES: ReadonlyMap<string, NodeStatus> = new Map();

const READ_ONLY_NOTE =
  'Read-only. The stages run in the order they are listed.';
const EDIT_NOTE =
  'Select a stage to edit it. The stages run in the order they are listed.';

/**
 * The card both tabs draw the workflow in: its name, then the graph. The
 * graph is read-only unless `selection` is given, and `statuses` puts a live
 * state on the nodes it names, by node id. `actions` sit at the right of the
 * header, and `toolbar` above the graph.
 */
export function WorkflowGraphCard({
  view,
  harness,
  statuses = NO_STATUSES,
  selection,
  actions,
  toolbar,
}: {
  view: WorkflowSpec;
  harness: string;
  statuses?: ReadonlyMap<string, NodeStatus>;
  selection?: CanvasSelection;
  actions?: ReactNode;
  toolbar?: ReactNode;
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
          description={selection ? EDIT_NOTE : READ_ONLY_NOTE}
          actions={actions}
        >
          Workflow: {view.name}
        </Header>
      }
    >
      <SpaceBetween size="m">
        {toolbar}
        <WorkflowCanvas graph={graph} selection={selection} />
      </SpaceBetween>
    </Container>
  );
}
