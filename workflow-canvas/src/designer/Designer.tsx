// SPDX-License-Identifier: Apache-2.0
import { WorkflowGraphCard } from '../canvas/WorkflowGraphCard';
import type { LoadResult } from '../workflow/load-workflow';
import { WorkflowGate } from '../workflow/WorkflowGate';
import { DesignerEditor } from './DesignerEditor';
import type { Editor } from './use-editor';

/**
 * The Designer tab: the workflow as a graph with its stages editable, or a
 * message while it loads (`result` is `undefined`), when it failed to load,
 * or when there is nothing to draw. Without an `editor` the graph is only
 * drawn.
 */
export function Designer({
  result,
  editor,
}: {
  result: LoadResult | undefined;
  editor?: Editor;
}) {
  return (
    <WorkflowGate result={result}>
      {({ view, harness }) =>
        editor ? (
          <DesignerEditor editor={editor} harness={harness} />
        ) : (
          <WorkflowGraphCard view={view} harness={harness} />
        )
      }
    </WorkflowGate>
  );
}
