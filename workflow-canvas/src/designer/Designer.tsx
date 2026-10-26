// SPDX-License-Identifier: Apache-2.0
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { LoadResult } from '../workflow/load-workflow';
import { WorkflowGate } from '../workflow/WorkflowGate';

/**
 * The Designer tab: the workflow drawn as a graph, or a message while it
 * loads (`result` is `undefined`), when it failed to load, or when there is
 * nothing to draw.
 */
export function Designer({ result }: { result: LoadResult | undefined }) {
  return (
    <WorkflowGate result={result}>
      {({ view, harness }) => (
        <WorkflowGraphCard view={view} harness={harness} />
      )}
    </WorkflowGate>
  );
}
