const { readJson, writeJson } = require('../stores/file-store');

class CheckpointStore {
  constructor(file) { this.file = file; }
  async read() { return readJson(this.file, { lastId: null, count: 0 }); }
  async write(value) { return writeJson(this.file, value); }
}

module.exports = { CheckpointStore };
