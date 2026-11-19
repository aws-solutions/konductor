const DEFAULT_TTL_MS = 30_000;

/**
 * Small process-local cache used for the read-heavy price endpoint.
 * The store is intentionally private so callers cannot replace its map.
 */
export class PriceCache {
  #entries = new Map();
  #clock;
  #defaultTtlMs;
  #maxEntries;

  constructor({ maxEntries = 500, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
    this.#maxEntries = maxEntries;
    this.#defaultTtlMs = ttlMs;
    this.#clock = now;
  }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#clock()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.#defaultTtlMs) {
    const expiresAt = this.#clock() + ttlMs;
    this.#entries.set(key, { value, expiresAt });
    return value;
  }

  delete(key) {
    return this.#entries.delete(key);
  }

  clear() {
    this.#entries.clear();
  }

  get size() {
    return this.#entries.size;
  }

  get limit() {
    return this.#maxEntries;
  }
}
