// SPDX-License-Identifier: Apache-2.0
import type { WorkflowApi } from '../api/api';
import type { SessionMemory } from '../launch/session-memory';
import { loadOnOpen, loadWorkflow, type LoadResult } from './load-workflow';

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
  /** Why the newest pasted code was refused while a workflow is on the page. */
  notice(): string | undefined;
  /** Calls `listener` when `notice` changes; returns the way to stop. */
  subscribeNotice(listener: () => void): () => void;
  /** Drops the notice. */
  dismissNotice(): void;
}

/**
 * Starts the first load at once, outside React: the launch code works only
 * once, and strict mode runs effects twice. With no code, the first load uses
 * the session that `memory` kept. The session of the workflow on the page is
 * the one that `memory` keeps.
 */
export function createWorkflowSource(
  api: WorkflowApi,
  firstCode: string | undefined,
  memory: SessionMemory,
): WorkflowSource {
  let current = loadOnOpen(api, firstCode, memory);
  let lastOffer = 0;
  let shownOffer = 0;
  let shownWorkflowOffer = 0;
  let notice: string | undefined;
  const listeners = new Set<() => void>();
  const noticeListeners = new Set<() => void>();
  const setNotice = (next: string | undefined) => {
    if (next === notice) return;
    notice = next;
    noticeListeners.forEach((listener) => listener());
  };
  const show = (offer: number, next: LoadResult) => {
    shownOffer = offer;
    if (next.ok) shownWorkflowOffer = offer;
    current = Promise.resolve(next);
    listeners.forEach((listener) => listener());
    if (next.ok) {
      next.remember();
      setNotice(undefined);
    }
  };
  // A workflow is shown unless a newer one is. An error is shown only while
  // no workflow is, and never over a newer answer. With a workflow on the
  // page, the refusal of the newest code is told in a notice instead.
  const offerLoaded = async (offer: number, next: LoadResult) => {
    if (next.ok) {
      if (offer > shownWorkflowOffer) show(offer, next);
      return;
    }
    if ((await current).ok) {
      if (offer === lastOffer) setNotice(next.message);
      return;
    }
    if (shownWorkflowOffer === 0 && offer > shownOffer) show(offer, next);
  };
  void current.then((first) => {
    if (first.ok && shownWorkflowOffer === 0) first.remember();
  });
  return {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notice: () => notice,
    subscribeNotice(listener) {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    dismissNotice: () => setNotice(undefined),
    async offer(code) {
      const offer = ++lastOffer;
      await offerLoaded(offer, await loadWorkflow(api, code, memory));
    },
  };
}
