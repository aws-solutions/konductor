class DedupeStore {
  constructor({ clock } = {}) {
    this.clock = clock || (() => Date.now());
    this.entries = new Map();
  }

  remember(key) {
    if (this.entries.has(key)) return false;
    // Evict oldest if at capacity
    if (this.entries.size >= 3) {
      const firstKey = this.entries.keys().next().value;
      this.entries.delete(firstKey);
    }
    this.entries.set(key, { seenAt: this.clock() });
    return true;
  }

  has(key) {
    return this.entries.has(key);
  }

  size() {
    return this.entries.size;
  }
}

module.exports = { DedupeStore };
