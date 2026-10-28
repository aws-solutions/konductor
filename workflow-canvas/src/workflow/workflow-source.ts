// SPDX-License-Identifier: Apache-2.0
import type { WorkflowApi } from '../api/api';
import { loadWorkflow, type LoadResult } from './load-workflow';

/** The workflow the page shows, and the way to offer it another launch code. */
export interface WorkflowSource {
  /** The load the page shows now. */
  current(): Promise<LoadResult>;
  /** Calls `listener` when `current` changes; returns the way to stop. */
  subscribe(listener: () => void): () => void;
  /**
   * Opens a session with `code`. The page changes to the new workflow only if
   * that works; a workflow on the page is never replaced by an error.
   */
  offer(code: string): Promise<void>;
}

/**
 * Starts the first load at once, outside React: the launch code works only
 * once, and strict mode runs effects twice.
 */
export function createWorkflowSource(
  api: WorkflowApi,
  firstCode: string | undefined,
): WorkflowSource {
  let current = loadWorkflow(api, firstCode);
  let latestOffer = 0;
  const listeners = new Set<() => void>();
  const swapTo = (next: Promise<LoadResult>) => {
    current = next;
    listeners.forEach((listener) => listener());
  };
  return {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async offer(code) {
      const offer = ++latestOffer;
      const next = await loadWorkflow(api, code);
      if (offer !== latestOffer) return;
      if (next.ok || !(await current).ok) swapTo(Promise.resolve(next));
    },
  };
}
