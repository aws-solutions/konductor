// SPDX-License-Identifier: Apache-2.0
import type { RunMemory } from './core';

const RUN_KEY = 'konductor-workflow-canvas-run';

/** The part of `window` that the memory of a run needs. */
export interface RunMemoryEnvironment {
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/**
 * Remembers the id of the latest run in the storage of the browser tab, so
 * that a reload of the page can find it again. The id is no secret; the
 * session is kept apart, by `launch/session-memory.ts`. A browser that blocks
 * storage leaves it with no memory.
 */
export function sessionRunMemory(env: RunMemoryEnvironment): RunMemory {
  return {
    recall() {
      try {
        return env.sessionStorage?.getItem(RUN_KEY) || undefined;
      } catch {
        return undefined;
      }
    },
    remember(runId) {
      try {
        env.sessionStorage?.setItem(RUN_KEY, runId);
      } catch {
        // Without storage there is nothing to remember.
      }
    },
    forget() {
      try {
        env.sessionStorage?.removeItem(RUN_KEY);
      } catch {
        // Without storage there is nothing to forget.
      }
    },
  };
}
