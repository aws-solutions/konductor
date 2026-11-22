'use strict';

class QuoteCache {
  constructor(ttlMs = 30000, clock = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.values = new Map();
  }

  get(key) {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.values.set(key, { value, expiresAt: this.clock() + this.ttlMs });
  }

  clear() { this.values.clear(); }
  get size() { return this.values.size; }
}

module.exports = { QuoteCache };
