// SPDX-License-Identifier: Apache-2.0
import { useSyncExternalStore } from 'react';
import type { LoadResult } from './load-workflow';
import type { WorkflowSource } from './workflow-source';

/** The load that `source` has now; the page draws again when it changes. */
export function useWorkflowSource(source: WorkflowSource): Promise<LoadResult> {
  return useSyncExternalStore(source.subscribe, source.current);
}
