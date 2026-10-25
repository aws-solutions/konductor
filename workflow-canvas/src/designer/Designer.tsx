// SPDX-License-Identifier: Apache-2.0
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import { useMemo } from 'react';
import { WorkflowCanvas } from '../canvas/WorkflowCanvas';
import { buildGraph } from '../graph';
import type { WorkflowView } from '../api/types';
import type { LoadedWorkflow, LoadResult } from '../workflow/load-workflow';
import { EmptyState, ErrorState, LoadingState } from './states';

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
