'use strict';

const { RetryQueue } = require('./queue');

const DEFAULTS = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 200,
  jitter: true,
  concurrency: 4,
});

/**
 * Create a queue with bounded retries and a concurrency limit.
 * @param {object} [opts] queue options
 * @returns {RetryQueue} a queue accepted by the other public functions
 */
function createQueue(opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError('createQueue expects an options object');
  }
  const options = {
    ...DEFAULTS,
    ...opts,
  };
  for (const key of ['maxAttempts', 'concurrency']) {
    if (!Number.isInteger(options[key]) || options[key] < 1) throw new RangeError(`${key} must be a positive integer`);
  }
  if (!Number.isInteger(options.baseDelayMs) || options.baseDelayMs < 0) throw new RangeError('baseDelayMs must be a non-negative integer');
  if (typeof options.jitter !== 'boolean') throw new TypeError('jitter must be boolean');
  return new RetryQueue(options);
}

/**
 * Add a job to the retry queue.
 * @param {RetryQueue} queue queue returned by createQueue
 * @param {Function|*} job work to run, or a value to resolve
 * @param {object} [opts] per-job options
 * @param {number} [opts.attemts] maximum attempts for this job
 */
function enqueue(queue, job, opts = {}) {
  assertQueue(queue);
  if (typeof job !== 'function' && job === undefined) throw new TypeError('job must be a function or value');
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('enqueue options must be an object');
  const maxAttempts = opts.attempts ?? queue.options.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('attempts must be a positive integer');
  const delayMs = opts.delayMs ?? queue.options.baseDelayMs;
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('delayMs must be non-negative');
  return queue.add(job, { ...opts, attempts: opts.attempts, maxAttempts, delayMs });
}

/**
 * Wait until all work currently known to the queue has settled.
 * @param {RetryQueue} queue queue returned by createQueue
 * @returns {Promise<Array>} failure records collected by the queue
 */
function drain(queue) {
  assertQueue(queue);
  return queue.drain();
}

/**
 * Register a callback for an exhausted job.
 * @param {RetryQueue} queue queue returned by createQueue
 * @param {Function} fn callback receiving the error and failure record
 * @returns {Function} unsubscribe function
 */
function onFailure(queue, fn) {
  assertQueue(queue);
  if (typeof fn !== 'function') throw new TypeError('failure handler must be a function');
  queue.failureHandlers.add(fn);
  return () => queue.failureHandlers.delete(fn);
}

/**
 * Stop starting pending jobs without interrupting active jobs.
 * @param {RetryQueue} queue queue returned by createQueue
 * @returns {RetryQueue} the same queue for fluent setup
 */
function pause(queue) {
  assertQueue(queue);
  queue.paused = true;
  return queue;
}

/**
 * Resume starting pending jobs.
 * @param {RetryQueue} queue queue returned by createQueue
 * @returns {RetryQueue} the same queue for fluent setup
 */
function resume(queue) {
  assertQueue(queue);
  queue.paused = false;
  queue.pump();
  return queue;
}

/**
 * @deprecated Use drain(queue) instead. This alias will be removed in 3.0.
 */
function retryNow(queue) {
  return drain(queue);
}

function assertQueue(queue) {
  if (!(queue instanceof RetryQueue)) throw new TypeError('expected a queue from createQueue');
}

module.exports = {
  createQueue,
  enqueue,
  drain,
  onFailure,
  pause,
  resume,
  retryNow,
};
