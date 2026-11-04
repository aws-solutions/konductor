// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import { useSyncExternalStore } from 'react';
import type { WorkflowSource } from '../workflow/workflow-source';

/** Tells that a pasted launch address was refused and the workflow is unchanged. */
export function LaunchNotice({
  source,
}: {
  source: Pick<WorkflowSource, 'notice' | 'subscribeNotice' | 'dismissNotice'>;
}) {
  const message = useSyncExternalStore(source.subscribeNotice, source.notice);
  if (message === undefined) return null;
  return (
    <div role="alert" data-testid="launch-notice">
      <Alert
        type="warning"
        header="The launch address was not opened"
        dismissible
        dismissAriaLabel="Dismiss"
        onDismiss={source.dismissNotice}
      >
        {message} The open workflow is unchanged.
      </Alert>
    </div>
  );
}
