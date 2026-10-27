// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useMemo, type ReactNode } from 'react';
import {
  buildGraph,
  withStatuses,
  type NodeStatus,
  type WorkflowSpec,
} from '../graph';
import { INTENT_FITS_IN_NODE, clippedStages, textWidth } from './clipping';
import { WorkflowCanvas, type CanvasSelection } from './WorkflowCanvas';

/** The text that the nodes cut short, in full, under the graph. */
function FullText({ view, harness }: { view: WorkflowSpec; harness: string }) {
  const stages = clippedStages(view, harness);
  const showIntent = textWidth(view.intent.outcome) > INTENT_FITS_IN_NODE;
  if (!showIntent && stages.length === 0) return null;
  return (
    <Box variant="div" data-testid="full-text">
      {showIntent && (
        <Box variant="p" data-testid="full-intent">
          <strong>Intent:</strong> {view.intent.outcome}
        </Box>
      )}
      {stages.map(({ id, name, agent }) => (
        <Box variant="p" key={id ?? name} data-testid={`full-stage-${name}`}>
          <strong>Stage {name}:</strong> {agent} · {harness}
        </Box>
      ))}
    </Box>
  );
}

const NO_STATUSES: ReadonlyMap<string, NodeStatus> = new Map();

const READ_ONLY_NOTE =
  'Read-only. The stages run in the order they are listed.';
const EDIT_NOTE =
  'Select a stage to edit it. The stages run in the order they are listed.';

/**
 * The card both tabs draw the workflow in: its name, then the graph. The
 * graph is read-only unless `selection` is given, and `statuses` puts a live
 * state on the nodes it names, by node id. `toolbar` sits above the graph.
 */
export function WorkflowGraphCard({
  view,
  harness,
  statuses = NO_STATUSES,
  selection,
  toolbar,
}: {
  view: WorkflowSpec;
  harness: string;
  statuses?: ReadonlyMap<string, NodeStatus>;
  selection?: CanvasSelection;
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
        >
          Workflow: {view.name}
        </Header>
      }
    >
      <SpaceBetween size="m">
        {toolbar}
        <WorkflowCanvas graph={graph} selection={selection} />
      </SpaceBetween>
      <FullText view={view} harness={harness} />
    </Container>
  );
}
