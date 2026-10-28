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
  let lastOffer = 0;
  let shownOffer = 0;
  let shownWorkflowOffer = 0;
  const listeners = new Set<() => void>();
  const show = (offer: number, next: LoadResult) => {
    shownOffer = offer;
    if (next.ok) shownWorkflowOffer = offer;
    current = Promise.resolve(next);
    listeners.forEach((listener) => listener());
  };
  // A workflow is shown unless a newer one is. An error is shown only while
  // no workflow is, and never over a newer answer.
  const offerLoaded = async (offer: number, next: LoadResult) => {
    if (next.ok) {
      if (offer > shownWorkflowOffer) show(offer, next);
      return;
    }
    if ((await current).ok) return;
    if (shownWorkflowOffer === 0 && offer > shownOffer) show(offer, next);
  };
  return {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async offer(code) {
      const offer = ++lastOffer;
      await offerLoaded(offer, await loadWorkflow(api, code));
    },
  };
}
