function rateLimit(config, clock) {
  const rlConfig = config.rateLimit;
  if (!rlConfig) {
    return function noopMiddleware(_request, _response, next) {
      next();
    };
  }
  
  const windowMs = rlConfig.windowMs || 60000;
  const maxClients = rlConfig.maxClients || 1000;
  const defaultPlan = rlConfig.defaultPlan || 'free';
  const plans = rlConfig.plans || { free: { limit: 5 } };
  const keyPlans = rlConfig.keyPlans || {};

  const clients = new Map();

  function cleanup(now) {
    for (const [key, entry] of clients) {
      if (now - entry.windowStart >= windowMs) {
        clients.delete(key);
      }
    }
    while (clients.size > maxClients) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, entry] of clients) {
        if (entry.lastSeen < oldestTime) {
          oldestTime = entry.lastSeen;
          oldestKey = key;
        }
      }
      if (oldestKey) clients.delete(oldestKey);
    }
  }

  return function middleware(request, response, next) {
    const apiKey = request.headers['x-api-key'] || request.headers['x-booking-api-key'];
    if (!apiKey || apiKey.trim() === '') {
      response.json(401, { error: { code: 'missing_api_key', message: 'API key is required' } });
      return;
    }

    const now = clock ? clock() : Date.now();
    cleanup(now);

    let entry = clients.get(apiKey);
    if (!entry || now - entry.windowStart >= windowMs) {
      const planName = keyPlans[apiKey] || defaultPlan;
      const plan = plans[planName] || plans[defaultPlan];
      entry = { count: 0, windowStart: now, limit: plan.limit, lastSeen: now };
      clients.set(apiKey, entry);
    }

    entry.lastSeen = now;

    if (entry.count >= entry.limit) {
      const retryAfter = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      response.setHeader('RateLimit-Limit', String(entry.limit));
      response.setHeader('RateLimit-Remaining', '0');
      response.setHeader('Retry-After', String(retryAfter));
      response.json(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } });
      return;
    }

    entry.count++;
    const remaining = Math.max(0, entry.limit - entry.count);
    response.setHeader('RateLimit-Limit', String(entry.limit));
    response.setHeader('RateLimit-Remaining', String(remaining));
    next();
  };
}

module.exports = { rateLimit };
