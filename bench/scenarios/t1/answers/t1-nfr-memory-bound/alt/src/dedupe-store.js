class DedupeStore {
  constructor({ clock } = {}) {
    this.clock = clock || (() => Date.now());
    this._entries = new Map(); // normalizedKey -> { originalKey, seenAt, order }
    this._order = 0;
    this._max = 3;
    this._windowMs = 60000;
    this._evictions = 0;
    this._expirations = 0;
  }

  _normalize(key) {
    return typeof key === 'string' ? key.trim().toLowerCase() : key;
  }

  _expireOlderThan(threshold) {
    const toDelete = [];
    for (const [normalizedKey, entry] of this._entries) {
      if (entry.seenAt < threshold) {
        toDelete.push(normalizedKey);
      }
    }
    for (const key of toDelete) {
      this._entries.delete(key);
      this._expirations += 1;
    }
  }

  _evictOldest() {
    let oldest = null;
    for (const [normalizedKey, entry] of this._entries) {
      if (!oldest || entry.seenAt < oldest.seenAt || 
          (entry.seenAt === oldest.seenAt && entry.order < oldest.order)) {
        oldest = { normalizedKey, seenAt: entry.seenAt, order: entry.order };
      }
    }
    if (oldest) {
      this._entries.delete(oldest.normalizedKey);
      this._evictions += 1;
    }
  }

  remember(key) {
    const normalizedKey = this._normalize(key);
    if (normalizedKey === undefined || normalizedKey === null) {
      return false;
    }
    
    const now = this.clock();
    
    // Expire old entries first
    this._expireOlderThan(now - this._windowMs);
    
    // Check for duplicate (after expiry, so expired keys can be re-remembered)
    if (this._entries.has(normalizedKey)) {
      return false;
    }
    
    // Evict oldest if at capacity (after expiry)
    if (this._entries.size >= this._max) {
      this._evictOldest();
    }
    
    // Remember the key
    this._entries.set(normalizedKey, {
      originalKey: key,
      seenAt: now,
      order: this._order++
    });
    
    return true;
  }

  has(key) {
    const normalizedKey = this._normalize(key);
    if (!this._entries.has(normalizedKey)) {
      return false;
    }
    const entry = this._entries.get(normalizedKey);
    const now = this.clock();
    if (entry.seenAt < now - this._windowMs) {
      return false;
    }
    return true;
  }

  size() {
    return this._entries.size;
  }

  stats() {
    return {
      remembered: this._entries.size,
      max: this._max,
      windowMs: this._windowMs,
      evictions: this._evictions,
      expirations: this._expirations
    };
  }
}

module.exports = { DedupeStore };
