// SPDX-License-Identifier: Apache-2.0
import type { Scheduler } from './core';

/** The scheduler of the page: waits with a browser timer. */
export const timerScheduler: Scheduler = {
  wait(ms, signal) {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish);
    });
  },
};
