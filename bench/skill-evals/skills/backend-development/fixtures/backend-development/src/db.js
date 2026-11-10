'use strict';

class ConditionalCheckFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConditionalCheckFailedError';
  }
}

const tables = new Map();

function table(name) {
  if (!tables.has(name)) tables.set(name, new Map());
  return tables.get(name);
}

function checkCondition(existing, condition) {
  if (!condition) return;
  if ('exists' in condition) {
    if (Boolean(existing) !== condition.exists) {
      throw new ConditionalCheckFailedError('The conditional request failed');
    }
    return;
  }
  if (!existing || existing[condition.attr] !== condition.equals) {
    throw new ConditionalCheckFailedError('The conditional request failed');
  }
}

const db = {
  calls: [],

  async get(tableName, key) {
    this.calls.push(['get', tableName, key]);
    const item = table(tableName).get(key);
    return item ? { ...item } : undefined;
  },

  async put(tableName, key, item, opts = {}) {
    this.calls.push(['put', tableName, key]);
    const t = table(tableName);
    checkCondition(t.get(key), opts.condition);
    t.set(key, { ...item });
    return { ...item };
  },

  async update(tableName, key, changes, opts = {}) {
    this.calls.push(['update', tableName, key]);
    const t = table(tableName);
    const existing = t.get(key);
    checkCondition(existing, opts.condition);
    if (!existing) throw new Error(`Item ${key} not found`);
    const merged = { ...existing, ...changes };
    t.set(key, merged);
    return { ...merged };
  },

  reset() {
    tables.clear();
    this.calls.length = 0;
  },
};

module.exports = { db, ConditionalCheckFailedError };
