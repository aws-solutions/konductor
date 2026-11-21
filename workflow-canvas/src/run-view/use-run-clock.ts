// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import type { Scheduler } from '../execution/core/ports';

/**
 * How often the clock is read while a run goes on: twice a second, so the
 * seconds shown are never a whole second behind. No wait of the run follower
 * is this long, so neither waits on the other.
 */
export const RUN_TICK_MS = 500;

/**
 * The time to show a run by, read every `RUN_TICK_MS` while `ticking`, so the
 * elapsed time moves on through a stage that sends nothing. One wait is in
 * flight at a time, the loop stops when `ticking` goes false and when the
 * view unmounts, and no state is set after that. While it does not tick the
 * time last read stays, which is the time the run ended by.
 */
export function useRunClock({
  scheduler,
  now,
  ticking,
}: {
  /** Waits between two readings of the clock. */
  readonly scheduler: Scheduler;
  /** The time now, in milliseconds. Read when a wait ends. */
  readonly now: () => number;
  /** True while the run goes on. */
  readonly ticking: boolean;
}): number {
  const latest = useRef({ scheduler, now });
  const [sampled, setSampled] = useState(() => now());

  useEffect(() => {
    latest.current = { scheduler, now };
  });

  useEffect(() => {
    if (!ticking) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Read once at the start, so a run that is taken up again shows its
    // elapsed time before the first wait ends.
    setSampled(latest.current.now());
    const tick = async () => {
      while (!signal.aborted) {
        await latest.current.scheduler.wait(RUN_TICK_MS, signal);
        if (signal.aborted) return;
        setSampled(latest.current.now());
      }
    };
    void tick();
    return () => controller.abort();
  }, [ticking]);

  return sampled;
}
