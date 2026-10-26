// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import { useMemo } from 'react';
import type { WorkflowView } from '../api/types';
import { buildGraph, withStatuses, type NodeStatus } from '../graph';
import { INTENT_FITS_IN_NODE, clippedStages, textWidth } from './clipping';
import { WorkflowCanvas } from './WorkflowCanvas';

/** The text that the nodes cut short, in full, under the graph. */
function FullText({ view, harness }: { view: WorkflowView; harness: string }) {
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
      {stages.map(({ name, agent }) => (
        <Box variant="p" key={name} data-testid={`full-stage-${name}`}>
          <strong>Stage {name}:</strong> {agent} · {harness}
        </Box>
      ))}
    </Box>
  );
}

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
      <FullText view={view} harness={harness} />
    </Container>
  );
}
