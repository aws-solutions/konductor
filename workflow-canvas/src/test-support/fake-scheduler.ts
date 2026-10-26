// SPDX-License-Identifier: Apache-2.0
import type { Scheduler } from '../execution/core';

/**
 * A scheduler that waits until a test says so. `tick()` ends every wait that
 * is pending, as if its time had come; aborting a wait ends it too.
 */
export class FakeScheduler implements Scheduler {
  /** The `ms` of each wait asked for, in order. */
  readonly waits: number[] = [];
  private pending = new Set<() => void>();

  wait(ms: number, signal: AbortSignal): Promise<void> {
    this.waits.push(ms);
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      this.pending.add(resolve);
      signal.addEventListener('abort', () => {
        this.pending.delete(resolve);
        resolve();
      });
    });
  }

  /** How many waits are pending. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Ends the pending waits. */
  tick(): void {
    const ending = [...this.pending];
    this.pending.clear();
    for (const end of ending) end();
  }
}
