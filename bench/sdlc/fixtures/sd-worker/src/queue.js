'use strict';

/**
 * In-memory job queue. `push(job)` adds a job; `take()` resolves with the next job, waiting when the queue is empty;
 * `size()` counts jobs not yet taken; `close()` makes every waiting and later `take()` resolve with null.
 */
function createQueue() {
  const jobs = [];
  const waiting = [];
  let closed = false;
  return {
    push(job) {
      if (waiting.length) waiting.shift()(job);
      else jobs.push(job);
    },
    take() {
      if (jobs.length) return Promise.resolve(jobs.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
    size: () => jobs.length,
    close() {
      closed = true;
      while (waiting.length) waiting.shift()(null);
    },
  };
}

module.exports = { createQueue };
