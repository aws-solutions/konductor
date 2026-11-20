// Per-key request limit: counts requests per x-api-key and refuses once the free limit is used.
function rateLimit(config) {
  const limit = config.rateLimit?.plans?.free?.limit ?? 5;
  const counts = new Map();

  return function middleware(request, response, next) {
    const apiKey = request.headers['x-api-key'];
    if (!apiKey) {
      response.json(401, { error: { code: 'missing_api_key', message: 'API key is required' } });
      return;
    }
    const used = counts.get(apiKey) || 0;
    if (used >= limit) {
      response.json(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded' } });
      return;
    }
    counts.set(apiKey, used + 1);
    next();
  };
}

module.exports = { rateLimit };
