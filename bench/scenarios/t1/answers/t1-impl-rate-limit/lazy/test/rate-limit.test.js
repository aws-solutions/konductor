const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, request } = require('./helpers');

test('missing API key returns 401', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings');
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'missing_api_key');
  }, { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json', rateLimit: { windowMs: 60000, maxClients: 1000, defaultPlan: 'free', plans: { free: { limit: 5 } } } } });
});
