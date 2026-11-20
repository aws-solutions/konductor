'use strict';

class TTLCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 300000;
    this.maxSize = options.maxSize ?? Infinity;
    this.sweepIntervalMs = options.sweepIntervalMs ?? 60000;
    this.now = options.now || Date.now;
    this.sizeCalculation = options.sizeCalculation || (() => 1);
    this._entries = new Map();
    this._weight = 0;
    this._hits = 0;
    this._misses = 0;
    this._timer = null;

    if (this.sweepIntervalMs > 0 && Number.isFinite(this.sweepIntervalMs)) {
      this._timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
      this._timer.unref?.();
    }
  }

  get size() {
    return this._entries.size;
  }

  get weight() {
    return this._weight;
  }

  get(key) {
    const entry = this._entries.get(key);
    if (!entry) {
      this._misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this._remove(key, entry);
      this._misses += 1;
      return undefined;
    }
    this._hits += 1;
    return entry.value;
  }

  has(key) {
    const entry = this._entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this._remove(key, entry);
      return false;
    }
    return true;
  }

  set(key, value, ttlMs = this.ttlMs) {
    const weight = this._entryWeight(value);
    const old = this._entries.get(key);
    const entry = {
      value,
      weight,
      expiresAt: this.now() + ttlMs
    };

    if (old) {
      this._weight -= old.weight;
    }
    this._weight += weight;
    this._entries.set(key, entry);
    this._trim();
    return this;
  }

  delete(key) {
    const entry = this._entries.get(key);
    if (!entry) return false;
    this._remove(key, entry);
    return true;
  }

  clear() {
    this._entries.clear();
    this._weight = 0;
  }

  sweep() {
    for (const key of this._entries.keys()) {
      this.get(key);
    }
  }

  stats() {
    return { hits: this._hits, misses: this._misses };
  }

  close() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _entryWeight(value) {
    const weight = Number(this.sizeCalculation(value));
    if (!Number.isFinite(weight) || weight < 0) {
      throw new TypeError('sizeCalculation must return a non-negative number');
    }
    return weight;
  }

  _remove(key, entry) {
    this._entries.delete(key);
    this._weight -= entry.weight;
  }

  _trim() {
    while (this._weight > this.maxSize && this._entries.size > 0) {
      const oldest = this._entries.keys().next().value;
      const entry = this._entries.get(oldest);
      this._remove(oldest, entry);
    }
  }
}

module.exports = { TTLCache };
