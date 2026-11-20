'use strict';

function createMemoryStore() {
  const records = new Map();
  return {
    save(record) { records.set(record.id, { ...record }); return { ...record }; },
    get(id) { const value = records.get(id); return value ? { ...value } : null; },
    count() { return records.size; }
  };
}

module.exports = { createMemoryStore };
