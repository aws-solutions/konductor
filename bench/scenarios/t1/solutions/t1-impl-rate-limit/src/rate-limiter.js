class RateLimiter {
  constructor(settings, clock = Date.now) {
    this.settings = settings;
    this.clock = clock;
    this.clients = new Map();
    this.accessSequence = 0;
  }

  planFor(key) {
    const name = this.settings.keyPlans && this.settings.keyPlans[key] || this.settings.defaultPlan;
    return { name, limit: this.settings.plans[name].limit };
  }

  removeExpired(now) {
    for (const [key, entry] of this.clients) {
      if (now >= entry.windowStart + this.settings.windowMs) this.clients.delete(key);
    }
  }

  makeRoom(now) {
    this.removeExpired(now);
    const maxClients = Math.max(1, Number(this.settings.maxClients) || 1);
    if (this.clients.size < maxClients) return;
    let oldestKey;
    let oldestTime = Infinity;
    for (const [key, entry] of this.clients) {
      if (entry.lastSeen < oldestTime) {
        oldestKey = key;
        oldestTime = entry.lastSeen;
      }
    }
    if (oldestKey !== undefined) this.clients.delete(oldestKey);
  }

  check(key) {
    const now = Number(this.clock());
    let entry = this.clients.get(key);
    if (entry && now >= entry.windowStart + this.settings.windowMs) {
      this.clients.delete(key);
      entry = undefined;
    }
    if (!entry) {
      this.makeRoom(now);
      entry = { count: 0, windowStart: now, lastSeen: ++this.accessSequence };
      this.clients.set(key, entry);
    }
    entry.lastSeen = ++this.accessSequence;
    const plan = this.planFor(key);
    if (entry.count >= plan.limit) {
      return {
        allowed: false,
        limit: plan.limit,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((entry.windowStart + this.settings.windowMs - now) / 1000))
      };
    }
    entry.count += 1;
    return { allowed: true, limit: plan.limit, remaining: plan.limit - entry.count };
  }
}

module.exports = { RateLimiter };
