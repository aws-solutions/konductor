class WorkerRunner {
  constructor({ queue, handlers, logger = console } = {}) {
    this.queue = queue;
    this.handlers = handlers;
    this.logger = logger;
    this.stopped = false;
  }

  async runOnce() {
    const job = await this.queue.takeNext();
    if (!job) return false;
    const handler = this.handlers[job.type];
    try {
      if (!handler) throw new Error(`Unknown job type: ${job.type}`);
      await handler(job);
      this.logger.info('job completed', { jobId: job.id, type: job.type });
    } catch (error) {
      this.logger.error('job failed', { jobId: job.id, type: job.type, error: error.message });
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

module.exports = { WorkerRunner };
