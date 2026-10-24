// SPDX-License-Identifier: Apache-2.0
import type { Clock } from '../core/clock.ts';

/** A clock that only moves when a test moves it, so no test waits. */
export class FakeClock implements Clock {
  private time: number;

  constructor(start = Date.UTC(2026, 9, 24, 4, 12, 5)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

/** Run id suffixes `00001`, `00002` and so on. */
export function countingSuffix(): () => string {
  let count = 0;
  return () => String(++count).padStart(5, '0');
}
