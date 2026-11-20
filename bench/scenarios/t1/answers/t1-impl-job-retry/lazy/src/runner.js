class WorkerRunner {
  constructor({ queue, handlers, logger = console, retryPolicies = {} } = {}) {
    this.queue = queue;
    this.handlers = handlers;
    this.logger = logger;
    this.retryPolicies = retryPolicies;
    this.stopped = false;
  }

  async runOnce() {
    const job = await this.queue.takeNext();
    if (!job) return false;
    const handler = this.handlers[job.type];
    const policy = this.retryPolicies[job.type] || {};
    try {
      if (!handler) throw new Error(`Unknown job type: ${job.type}`);
      await handler(job);
      this.logger.info('job completed', { jobId: job.id, type: job.type });
    } catch (error) {
      const maxAttempts = policy.maxAttempts || 1;
      if (job.attempts < maxAttempts) {
        const delay = (policy.baseDelayMs || 1000) * Math.pow(2, job.attempts - 1);
        await this.queue.requeue({ ...job, availableAt: Date.now() + delay });
        this.logger.info('job retry scheduled', { jobId: job.id, type: job.type, attempts: job.attempts });
      } else {
        await this.queue.deadLetter(job, error.message);
        this.logger.error('job failed', { jobId: job.id, type: job.type, error: error.message });
      }
    }
    return true;
  }

  async run({ signal, intervalMs = 250 } = {}) {
    while (!this.stopped && !(signal && signal.aborted)) {
      const didWork = await this.runOnce();
      if (!didWork) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
  }

  stop() {
    this.stopped = true;
  }
}

function retryDelay(policy, attempts, randomValue) {
  const base = policy.baseDelayMs || 1000;
  const max = policy.maxDelayMs || 30000;
  const delay = Math.min(base * Math.pow(2, attempts - 1), max);
  return delay;
}

module.exports = { WorkerRunner, retryDelay };
