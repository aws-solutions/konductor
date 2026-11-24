'use strict';

class RetryQueue {
  constructor(options) {
    this.options = Object.freeze({ ...options });
    this.pending = [];
    this.active = 0;
    this.paused = false;
    this.waiters = [];
    this.failures = [];
    this.failureHandlers = new Set();
    this.nextId = 1;
  }

  /**
   * Add one item to the in-memory pending list.
   * Promise settlement belongs to the item so callers can await a single job
   * while drain continues to represent the whole queue.
   */
  add(job, options) {
    return new Promise((resolve, reject) => {
      const item = {
        id: this.nextId++,
        job,
        attempts: options.attempts,
        resolve,
        reject,
        attempt: 0,
        delayMs: options.delayMs,
        maxAttempts: options.maxAttempts,
      };
      this.pending.push(item);
      this.pump();
    });
  }

  /**
   * Run one item and put retryable failures back at the front of the list.
   * The active counter is changed in one finally block so a throwing observer
   * cannot strand capacity.
   */
  async execute(item) {
    item.attempt += 1;
    try {
      const value = typeof item.job === 'function' ? await item.job(item.attempt) : item.job;
      item.resolve(value);
    } catch (error) {
      const limit = item.attempts ?? item.maxAttempts;
      if (item.attempt < limit) {
        const backoff = item.delayMs * (2 ** (item.attempt - 1));
        if (this.options.jitter) {
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(backoff * (0.75 + Math.random() * 0.5)))));
        } else {
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
        this.pending.unshift(item);
      } else {
        const record = { id: item.id, attempts: item.attempt, error };
        this.failures.push(record);
        for (const handler of this.failureHandlers) {
          try { handler(error, record); } catch { /* failure observers cannot stop the queue */ }
        }
        item.reject(error);
      }
    } finally {
      this.active -= 1;
      this.pump();
      this.notifyIfIdle();
    }
  }

  /**
   * Start as many pending items as the current concurrency setting allows.
   * A paused queue deliberately leaves this method with pending work intact.
   */
  pump() {
    while (!this.paused && this.active < this.options.concurrency && this.pending.length) {
      const item = this.pending.shift();
      this.active += 1;
      void this.execute(item);
    }
    this.notifyIfIdle();
  }

  /**
   * Resolve drain waiters only after both active and pending work are empty.
   * A copy of failures prevents later queue activity from changing a result
   * that a caller has already received.
   */
  notifyIfIdle() {
    if (this.active !== 0 || this.pending.length !== 0) return;
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve(this.failures.slice());
  }

  /**
   * Return a promise for the next idle transition.
   * Calling drain on an idle queue still returns a snapshot asynchronously,
   * which keeps the public return type stable.
   */
  drain() {
    this.pump();
    if (this.active === 0 && this.pending.length === 0) return Promise.resolve(this.failures.slice());
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

module.exports = { RetryQueue };
