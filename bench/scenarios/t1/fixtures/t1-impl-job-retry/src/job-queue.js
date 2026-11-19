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
    state.pending.push({ id: job.id, type: job.type, payload: job.payload, attempts: 0 });
    await this._save();
  }

  async takeNext() {
    const state = await this._state();
    const job = state.pending.shift();
    if (!job) return null;
    job.attempts = (job.attempts || 0) + 1;
    await this._save();
    return job;
  }

  async requeue(job) {
    const state = await this._state();
    state.pending.push(job);
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
