const { isDue } = require('./calendar');
const { createJob } = require('./jobs');

class ReminderService {
  constructor({ outbox, limiter, timeZone = 'UTC' }) {
    this.outbox = outbox;
    this.limiter = limiter;
    this.timeZone = timeZone;
    this.jobs = new Map();
  }

  add(input, random) {
    const job = createJob(input, random);
    this.jobs.set(job.id, job);
    return job;
  }

  remove(id) {
    return this.jobs.delete(id);
  }

  list() {
    return [...this.jobs.values()];
  }

  async runDue(instant = new Date()) {
    const sent = [];
    for (const job of this.jobs.values()) {
      if (!job.enabled || !isDue(job.rule, instant, this.timeZone)) continue;
      if (!this.limiter.allow(job.id, instant.getTime())) continue;
      const message = { jobId: job.id, title: job.title, at: instant.toISOString() };
      await this.outbox.enqueue(message);
      sent.push(message);
    }
    return sent;
  }
}

module.exports = { ReminderService };
