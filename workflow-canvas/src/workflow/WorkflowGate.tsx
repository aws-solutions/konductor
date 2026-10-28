// SPDX-License-Identifier: Apache-2.0
import { Fragment, type ReactNode } from 'react';
import type { WorkflowView } from '../api/types';
import type { LoadResult } from './load-workflow';
import { EmptyState, ErrorState, LoadingState } from './states';
import { useChangeCount } from './use-change-count';

/** A workflow that can be drawn, with the harness that runs its stages. */
export interface DrawableWorkflow {
  view: WorkflowView;
  harness: string;
}

/**
 * Shows what a tab shows before it has a workflow to draw: a message while
 * the load is under way (`result` is `undefined`), when it failed, or when
 * there is nothing to draw. Once there is a workflow it renders `children`.
 */
export function WorkflowGate({
  result,
  children,
}: {
  result: LoadResult | undefined;
  children: (workflow: DrawableWorkflow) => ReactNode;
}) {
  // A new workflow gets a new canvas, which is fitted to it when it mounts.
  const swaps = useChangeCount(result);
  if (!result) return <LoadingState />;
  if (!result.ok) return <ErrorState message={result.message} />;
  const { document, harness } = result.workflow;
  if (!document.view) {
    return (
      <EmptyState
        hasFile={document.text !== null}
        diagnostics={document.diagnostics}
      />
    );
  }
  return (
    <Fragment key={swaps}>
      {children({ view: document.view, harness })}
    </Fragment>
  );
}
