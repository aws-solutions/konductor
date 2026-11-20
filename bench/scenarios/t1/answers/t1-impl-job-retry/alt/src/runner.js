class WorkerRunner {
  constructor({
    queue,
    handlers,
    logger = console,
    retryPolicies = {},
    clock,
    random
  } = {}) {
    this.queue = queue;
    this.handlers = handlers;
    this.logger = logger;
    this.retryPolicies = retryPolicies;
    this.clock = clock || {
      now: () => Date.now(),
      sleep: (ms, signal) => new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
          reject(signal.reason || new Error('Aborted'));
          return;
        }
        const timer = setTimeout(resolve, ms);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason || new Error('Aborted'));
          });
        }
      })
    };
    this.random = random || Math.random;
    this.stopped = false;
  }

  _shouldRetry(error, job, policy) {
    if (error.retryable === false) return false;
    if (error.name === 'PermanentJobError') return false;
    if (policy.shouldRetry) {
      return policy.shouldRetry(error, job);
    }
    return true;
  }

  async runOnce() {
    const state = await this.queue._state();
    const now = this.clock.now();
    
    // Find next available job
    let jobIndex = state.pending.findIndex(j => !j.availableAt || j.availableAt <= now);
    if (jobIndex === -1) return false;
    
    const job = state.pending.splice(jobIndex, 1)[0];
    job.attempts = (job.attempts || 0) + 1;
    await this.queue._save();
    
    const handler = this.handlers[job.type];
    const policy = this.retryPolicies[job.type] || {};
    const maxAttempts = policy.maxAttempts || 1;
    
    try {
      if (!handler) throw new Error(`Unknown job type: ${job.type}`);
      await handler(job);
      this.logger.info('job completed', { jobId: job.id, type: job.type });
    } catch (error) {
      const canRetry = this._shouldRetry(error, job, policy);
      
      if (canRetry && job.attempts < maxAttempts) {
        const delay = retryDelay(policy, job.attempts, this.random());
        const availableAt = this.clock.now() + delay;
        await this.queue.requeue({ ...job, availableAt });
        this.logger.info('job retry scheduled', {
          jobId: job.id,
          type: job.type,
          attempts: job.attempts,
          availableAt
        });
      } else {
        await this.queue.deadLetter(job, error.message);
        this.logger.error('job failed', { jobId: job.id, type: job.type, error: error.message });
      }
    }
    return true;
  }

  async run({ signal, intervalMs = 250 } = {}) {
    while (!this.stopped && !(signal && signal.aborted)) {
      // Check for next available time and wait if needed
      const nextAt = await this.queue.nextAvailableAt();
      const now = this.clock.now();
      
      if (nextAt !== null && nextAt > now) {
        try {
          await this.clock.sleep(Math.min(nextAt - now, intervalMs), signal);
        } catch (e) {
          if (signal && signal.aborted) break;
          throw e;
        }
        continue;
      }
      
      const didWork = await this.runOnce();
      if (!didWork) {
        try {
          await this.clock.sleep(intervalMs, signal);
        } catch (e) {
          if (signal && signal.aborted) break;
          throw e;
        }
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
  const jitterFactor = policy.jitter || 0;
  
  const exponentialDelay = base * Math.pow(2, attempts - 1);
  const cappedDelay = Math.min(exponentialDelay, max);
  
  // Apply jitter: randomValue in [0, 1) scales jitterFactor
  const jitter = Math.floor(jitterFactor * randomValue);
  return cappedDelay + jitter;
}

module.exports = { WorkerRunner, retryDelay };
