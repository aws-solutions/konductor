// SPDX-License-Identifier: Apache-2.0
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import { useEffect, useState } from 'react';
import { useSettled } from '../designer/use-settled';
import type { LoadResult } from '../workflow/load-workflow';
import type { WorkflowSource } from '../workflow/workflow-source';

/** How long the first load may take before the page says it is still waiting. */
export const STILL_WAITING_MS = 5_000;

/**
 * Tells that the server is slow to answer the first load, and lets the person
 * stop waiting. Shows nothing while the load is quick or once it has settled.
 */
export function LaunchWait({
  load,
  source,
}: {
  load: Promise<LoadResult>;
  source: Pick<WorkflowSource, 'cancel'>;
}) {
  const settled = useSettled(load) !== undefined;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STILL_WAITING_MS);
    return () => clearTimeout(timer);
  }, []);
  if (settled || !slow) return null;
  return (
    <div role="status" data-testid="launch-wait">
      <Alert
        type="info"
        header="Still waiting for the server"
        action={<Button onClick={source.cancel}>Stop waiting</Button>}
      >
        The server has not answered yet. It may be busy, or stuck. If you stop
        waiting, the launch code may already have been used.
      </Alert>
    </div>
  );
}
