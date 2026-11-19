const { PermanentJobError } = require('./errors');

const defaultClock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const timer = setTimeout(done, ms);
      const onAbort = () => { clearTimeout(timer); reject(abortError()); };
      function done() {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }
};

function abortError() {
  const error = new Error('Runner stopped');
  error.name = 'AbortError';
  return error;
}

function retryDelay(policy, attempts, random) {
  const base = Math.max(0, Number(policy.baseDelayMs || 0));
  const cap = policy.maxDelayMs == null ? Infinity : Math.max(0, Number(policy.maxDelayMs));
  const exponential = Math.min(cap, base * (2 ** Math.max(0, attempts - 1)));
  const jitter = Math.max(0, Number(policy.jitter || 0));
  const factor = 1 + jitter * ((random == null ? Math.random() : random) * 2 - 1);
  return Math.max(0, Math.round(Math.min(cap, exponential * factor)));
}

class WorkerRunner {
  constructor({ queue, handlers, logger = console, retryPolicies = {}, clock = defaultClock, random = Math.random } = {}) {
    this.queue = queue;
    this.handlers = handlers;
    this.logger = logger;
    this.retryPolicies = retryPolicies;
    this.clock = clock;
    this.random = random;
    this.stopController = new AbortController();
  }

  _clockNow() {
    return typeof this.clock.now === 'function' ? this.clock.now() : Date.now();
  }

  async runOnce() {
    const job = await this.queue.takeNext(this._clockNow());
    if (!job) return false;
    const policy = this.retryPolicies[job.type] || { maxAttempts: 1 };
    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`Unknown job type: ${job.type}`);
      await handler(job);
      this.logger.info('job completed', { jobId: job.id, type: job.type, attempts: job.attempts });
    } catch (error) {
      const permanent = error instanceof PermanentJobError || error.retryable === false;
      const maxAttempts = Math.max(1, Number(policy.maxAttempts || 1));
      let retry = !permanent && job.attempts < maxAttempts;
      if (retry && typeof policy.shouldRetry === 'function') retry = await policy.shouldRetry(error, job);
      if (retry) {
        const delay = retryDelay(policy, job.attempts, this.random());
        job.availableAt = this._clockNow() + delay;
        await this.queue.requeue(job);
        this.logger.error('job scheduled for retry', { jobId: job.id, type: job.type, attempts: job.attempts, delayMs: delay, error: error.message });
      } else {
        if (typeof this.queue.deadLetter === 'function') {
          await this.queue.deadLetter(job, error.message);
        }
        this.logger.error('job moved to dead letter', { jobId: job.id, type: job.type, attempts: job.attempts, error: error.message });
      }
    }
    return true;
  }

  async run({ signal } = {}) {
    const signals = signal ? [signal, this.stopController.signal] : [this.stopController.signal];
    const runSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);
    while (!runSignal.aborted) {
      const didWork = await this.runOnce();
      if (runSignal.aborted) break;
      if (didWork) continue;
      const nextAt = typeof this.queue.nextAvailableAt === 'function' ? await this.queue.nextAvailableAt() : null;
      if (nextAt == null) return;
      const wait = Math.max(0, nextAt - this._clockNow());
      try {
        await this.clock.sleep(wait, runSignal);
      } catch (error) {
        if (runSignal.aborted || error.name === 'AbortError') return;
        throw error;
      }
    }
  }

  stop() {
    this.stopController.abort();
  }
}

module.exports = { WorkerRunner, retryDelay };
