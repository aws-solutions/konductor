const { readJson, writeJson } = require('./storage');

class JobQueue {
  constructor({ filePath } = {}) {
    this.filePath = filePath;
    this.state = null;
  }

  async _state() {
    if (!this.state) this.state = await readJson(this.filePath, { pending: [], deadLetter: [] });
    return this.state;
  }

  async _save() {
    await writeJson(this.filePath, this.state);
  }

  async enqueue(job) {
    const state = await this._state();
    state.pending.push({
      id: job.id,
      type: job.type,
      payload: job.payload,
      attempts: Number.isInteger(job.attempts) ? job.attempts : 0,
      ...(job.availableAt == null ? {} : { availableAt: job.availableAt })
    });
    await this._save();
  }

  async takeNext(now = Date.now()) {
    const state = await this._state();
    const index = state.pending.findIndex(job => job.availableAt == null || job.availableAt <= now);
    if (index === -1) return null;
    const job = state.pending.splice(index, 1)[0];
    job.attempts = (job.attempts || 0) + 1;
    delete job.availableAt;
    await this._save();
    return job;
  }

  async nextAvailableAt() {
    const pending = (await this._state()).pending;
    if (!pending.length) return null;
    return Math.min(...pending.map(job => job.availableAt == null ? 0 : job.availableAt));
  }

  async requeue(job) {
    const state = await this._state();
    state.pending.push({ ...job });
    await this._save();
  }

  async deadLetter(job, reason) {
    const state = await this._state();
    state.deadLetter.push({ ...job, reason });
    await this._save();
  }

  async list() {
    return [...(await this._state()).pending];
  }

  async listDeadLetters() {
    return [...(await this._state()).deadLetter];
  }

  async size() {
    return (await this._state()).pending.length;
  }
}

module.exports = { JobQueue };
