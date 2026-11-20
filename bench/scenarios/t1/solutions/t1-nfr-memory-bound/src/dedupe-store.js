const MAX_KEYS = 3;
const WINDOW_MS = 60_000;

function normalizeKey(key) {
  return String(key).trim().toLowerCase();
}

class DedupeStore {
  constructor({ clock } = {}) {
    this.clock = clock || (() => Date.now());
    this.entries = new Map();
    this.evictions = 0;
    this.expirations = 0;
  }

  remember(key) {
    const normalized = normalizeKey(key);
    const now = this.clock();
    this.purgeExpired(now);
    if (this.entries.has(normalized)) return false;

    if (this.entries.size >= MAX_KEYS) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
      this.evictions += 1;
    }
    this.entries.set(normalized, { seenAt: now });
    return true;
  }

  has(key) {
    const now = this.clock();
    this.purgeExpired(now);
    return this.entries.has(normalizeKey(key));
  }

  size() {
    this.purgeExpired(this.clock());
    return this.entries.size;
  }

  stats() {
    this.purgeExpired(this.clock());
    return {
      remembered: this.entries.size,
      max: MAX_KEYS,
      windowMs: WINDOW_MS,
      evictions: this.evictions,
      expirations: this.expirations
    };
  }

  purgeExpired(now) {
    for (const [key, entry] of this.entries) {
      if (now - entry.seenAt >= WINDOW_MS) {
        this.entries.delete(key);
        this.expirations += 1;
      }
    }
  }
}

module.exports = { DedupeStore };
