const fs = require('node:fs');
const path = require('node:path');

class MemoryStore {
  constructor(seedFile = 'data/seed.json') {
    const file = path.resolve(__dirname, '..', '..', seedFile);
    this.items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }

  all() {
    return this.items.map(item => ({ ...item }));
  }

  get(id) {
    const item = this.items.find(entry => entry.id === id);
    return item ? { ...item } : null;
  }

  insert(item) {
    this.items.push({ ...item });
    return { ...item };
  }

  remove(id) {
    const index = this.items.findIndex(entry => entry.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }
}

module.exports = { MemoryStore };
