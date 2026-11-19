const fs = require('node:fs');
const path = require('node:path');

class Outbox {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'notifications.jsonl');
  }

  async enqueue(message) {
    await fs.promises.mkdir(this.directory, { recursive: true });
    await fs.promises.appendFile(this.file, `${JSON.stringify(message)}\n`, 'utf8');
    return message;
  }

  async list() {
    try {
      const text = await fs.promises.readFile(this.file, 'utf8');
      return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error) return [];
      throw error;
    }
  }

  async clear() {
    await fs.promises.rm(this.directory, { recursive: true, force: true });
  }
}

module.exports = { Outbox };
