const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, request } = require('./helpers');

const baseConfig = {
  serviceName: 'booking-api',
  logLevel: 'silent',
  seedFile: 'data/seed.json',
  rateLimit: {
    windowMs: 60000,
    maxClients: 1000,
    defaultPlan: 'free',
    plans: {
      free: { limit: 5 },
      team: { limit: 20 }
    },
    keyPlans: {
      'team-demo': 'team'
    }
  }
};

test('missing API key returns 401 with missing_api_key code', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings');
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'missing_api_key');
  }, { config: baseConfig });
});

test('blank API key returns 401', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': '   ' });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'missing_api_key');
  }, { config: baseConfig });
});

test('x-api-key takes precedence over x-booking-api-key', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings', undefined, {
      'x-api-key': 'test-key',
      'x-booking-api-key': 'team-demo'
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-limit'], '5');
  }, { config: baseConfig });
});

test('health and ready endpoints are exempt from rate limiting', async () => {
  await withServer(async port => {
    const healthResult = await request(port, 'GET', '/health');
    assert.equal(healthResult.status, 200);
    assert.ok(!healthResult.headers['ratelimit-limit']);

    const readyResult = await request(port, 'GET', '/ready');
    assert.equal(readyResult.status, 200);
    assert.ok(!readyResult.headers['ratelimit-limit']);
  }, { config: baseConfig });
});

test('rate limit headers are included in booking responses', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-limit'], '5');
    assert.equal(result.headers['ratelimit-remaining'], '4');
  }, { config: baseConfig });
});

test('team plan uses higher limit', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'team-demo' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-limit'], '20');
  }, { config: baseConfig });
});

test('returns 429 when rate limit exceeded', async () => {
  const config = {
    ...baseConfig,
    rateLimit: {
      windowMs: 60000,
      maxClients: 1000,
      defaultPlan: 'free',
      plans: { free: { limit: 2 } },
      keyPlans: {}
    }
  };
  
  await withServer(async port => {
    await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    
    const result = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(result.status, 429);
    assert.equal(result.body.error.code, 'rate_limit_exceeded');
    assert.equal(result.headers['ratelimit-remaining'], '0');
    assert.ok(result.headers['retry-after']);
  }, { config });
});

test('quota is shared across booking routes', async () => {
  const config = {
    ...baseConfig,
    rateLimit: {
      windowMs: 60000,
      maxClients: 1000,
      defaultPlan: 'free',
      plans: { free: { limit: 3 } },
      keyPlans: {}
    }
  };
  
  await withServer(async port => {
    const r1 = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(r1.headers['ratelimit-remaining'], '2');
    
    const r2 = await request(port, 'POST', '/bookings', { room: 'A', date: '2025-01-01', owner: 'Test' }, { 'x-api-key': 'test-key' });
    assert.equal(r2.headers['ratelimit-remaining'], '1');
    
    const r3 = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(r3.headers['ratelimit-remaining'], '0');
  }, { config });
});

test('window resets after windowMs', async () => {
  const config = {
    ...baseConfig,
    rateLimit: {
      windowMs: 50,
      maxClients: 1000,
      defaultPlan: 'free',
      plans: { free: { limit: 1 } },
      keyPlans: {}
    }
  };
  
  await withServer(async port => {
    const r1 = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(r1.status, 200);
    
    const limited = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(limited.status, 429);
    
    // Wait for window to reset
    await new Promise(resolve => setTimeout(resolve, 60));
    
    const r3 = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(r3.status, 200);
  }, { config });
});

test('missing key does not consume quota', async () => {
  const config = {
    ...baseConfig,
    rateLimit: {
      windowMs: 60000,
      maxClients: 1000,
      defaultPlan: 'free',
      plans: { free: { limit: 1 } },
      keyPlans: {}
    }
  };
  
  await withServer(async port => {
    await request(port, 'GET', '/bookings');
    await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    const result = await request(port, 'GET', '/bookings', undefined, { 'x-api-key': 'test-key' });
    assert.equal(result.status, 429);
  }, { config });
});
