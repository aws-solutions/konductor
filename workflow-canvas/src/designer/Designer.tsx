// SPDX-License-Identifier: Apache-2.0
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import { useMemo } from 'react';
import { WorkflowCanvas } from '../canvas/WorkflowCanvas';
import { buildGraph } from '../graph';
import type { WorkflowView } from '../api/types';
import type { LoadedWorkflow, LoadResult } from '../workflow/load-workflow';
import { EmptyState, ErrorState, LoadingState } from './states';

/** An outcome longer than this is cut short in the intent node. */
export const INTENT_FITS_IN_NODE = 90;

/** The whole outcome, when the intent node can show only part of it. */
function FullIntent({ outcome }: { outcome: string }) {
  if (outcome.length <= INTENT_FITS_IN_NODE) return null;
  return (
    <Box variant="p" data-testid="full-intent">
      <strong>Intent:</strong> {outcome}
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
      <FullIntent outcome={view.intent.outcome} />
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
  if (!result) return <LoadingState />;
  if (!result.ok) return <ErrorState message={result.message} />;
  return <DrawnWorkflow workflow={result.workflow} />;
}
