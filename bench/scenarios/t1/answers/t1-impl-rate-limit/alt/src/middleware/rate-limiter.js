class RateLimiter {
  constructor(config, clock) {
    this.windowMs = config.windowMs || 60000;
    this.maxClients = config.maxClients || 1000;
    this.defaultPlan = config.defaultPlan || 'free';
    this.plans = config.plans || { free: { limit: 5 } };
    this.keyPlans = config.keyPlans || {};
    this.clock = clock || (() => Date.now());
    this.clients = new Map();
  }

  getPlanForKey(apiKey) {
    const planName = this.keyPlans[apiKey] || this.defaultPlan;
    return this.plans[planName] || this.plans[this.defaultPlan];
  }

  cleanupExpired(now) {
    for (const [key, entry] of this.clients) {
      if (now - entry.windowStart >= this.windowMs) {
        this.clients.delete(key);
      }
    }
  }

  evictLRU() {
    if (this.clients.size <= this.maxClients) return;
    
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.clients) {
      if (entry.lastSeen < oldestTime) {
        oldestTime = entry.lastSeen;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.clients.delete(oldestKey);
    }
  }

  getOrCreateEntry(apiKey, now) {
    let entry = this.clients.get(apiKey);
    
    if (!entry || now - entry.windowStart >= this.windowMs) {
      const plan = this.getPlanForKey(apiKey);
      entry = {
        count: 0,
        windowStart: now,
        limit: plan.limit,
        lastSeen: now
      };
      this.clients.set(apiKey, entry);
    }
    
    return entry;
  }

  checkLimit(request, response) {
    const apiKey = request.headers['x-api-key'] || request.headers['x-booking-api-key'];
    
    if (!apiKey || apiKey.trim() === '') {
      response.json(401, { error: { code: 'missing_api_key', message: 'API key is required' } });
      return { allowed: false, consumedQuota: false };
    }

    const now = this.clock();
    
    this.cleanupExpired(now);
    this.evictLRU();
    
    const entry = this.getOrCreateEntry(apiKey, now);
    entry.lastSeen = now;
    
    if (entry.count >= entry.limit) {
      const retryAfterSec = Math.ceil((this.windowMs - (now - entry.windowStart)) / 1000);
      response.setHeader('RateLimit-Limit', String(entry.limit));
      response.setHeader('RateLimit-Remaining', '0');
      response.setHeader('Retry-After', String(retryAfterSec));
      response.json(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } });
      return { allowed: false, consumedQuota: true };
    }
    
    entry.count++;
    const remaining = Math.max(0, entry.limit - entry.count);
    response.setHeader('RateLimit-Limit', String(entry.limit));
    response.setHeader('RateLimit-Remaining', String(remaining));
    return { allowed: true, consumedQuota: true };
  }
}

function createRateLimiter(config, clock) {
  return new RateLimiter(config, clock);
}

module.exports = { RateLimiter, createRateLimiter };
