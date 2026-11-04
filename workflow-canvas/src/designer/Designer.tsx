// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import { useMemo } from 'react';
import { WorkflowCanvas } from '../canvas/WorkflowCanvas';
import { buildGraph } from '../graph';
import type { WorkflowView } from '../api/types';
import type { LoadedWorkflow, LoadResult } from '../workflow/load-workflow';
import { INTENT_FITS_IN_NODE, clippedStages, textWidth } from './clipping';
import { EmptyState, ErrorState, LoadingState } from './states';
import { useChangeCount } from './use-change-count';

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

function DrawnGraph({
  view,
  harness,
}: {
  view: WorkflowView;
  harness: string;
}) {
  const graph = useMemo(() => buildGraph(view, harness), [view, harness]);
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

function DrawnWorkflow({ workflow }: { workflow: LoadedWorkflow }) {
  const { document, harness } = workflow;
  const { view } = document;
  if (!view) {
    return (
      <EmptyState
        hasFile={document.text !== null}
        diagnostics={document.diagnostics}
      />
    );
  }
  return <DrawnGraph view={view} harness={harness} />;
}

/**
 * The Designer tab: the workflow drawn as a graph, or a message while it
 * loads (`result` is `undefined`), when it failed to load, or when there is
 * nothing to draw.
 */
export function Designer({ result }: { result: LoadResult | undefined }) {
  // A new workflow gets a new canvas, which is fitted to it when it mounts.
  const swaps = useChangeCount(result);
  if (!result) return <LoadingState />;
  if (!result.ok) return <ErrorState message={result.message} />;
  return <DrawnWorkflow key={swaps} workflow={result.workflow} />;
}
