class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  allow(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || now - entry.startedAt > this.windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  reset(key) {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }

  size() {
    return this.entries.size;
  }
}

module.exports = { RateLimiter };
