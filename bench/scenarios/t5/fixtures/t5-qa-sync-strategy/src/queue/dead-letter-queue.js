const { appendFile, readFile } = require('node:fs/promises');
const path = require('node:path');

class DeadLetterQueue {
  constructor(file) { this.file = file; }
  async add(record, error) {
    await appendFile(this.file, `${JSON.stringify({ id: record.id, record })}\n`);
  }
  async list() {
    try { return (await readFile(this.file, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async ensureDirectory() { await require('node:fs/promises').mkdir(path.dirname(this.file), { recursive: true }); }
}

module.exports = { DeadLetterQueue };
