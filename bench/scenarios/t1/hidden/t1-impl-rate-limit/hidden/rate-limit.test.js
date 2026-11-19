const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

function config(overrides = {}) {
  return {
    serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json',
    rateLimit: {
      windowMs: 60000, maxClients: 100, defaultPlan: 'free',
      plans: { free: { limit: 5 }, team: { limit: 20 } },
      keyPlans: { 'team-demo': 'team' },
      ...overrides
    }
  };
}

async function withServer(run, options = {}) {
  const server = http.createServer(createApp(options));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function request(port, path = '/bookings', headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    req.end();
  });
}

function key(name) { return { 'x-api-key': name }; }

test('a booking route requires a non-empty API key', async () => {
  await withServer(async port => {
    const result = await request(port);
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'missing_api_key');
  }, { config: config() });
});

test('x-api-key authorizes a request and reports remaining quota', async () => {
  await withServer(async port => {
    const result = await request(port, '/bookings', key('free-demo'));
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-limit'], '5');
    assert.equal(result.headers['ratelimit-remaining'], '4');
  }, { config: config() });
});

test('the compatibility booking key header also authorizes requests', async () => {
  await withServer(async port => {
    const result = await request(port, '/bookings', { 'x-booking-api-key': 'free-demo' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-remaining'], '4');
  }, { config: config() });
});

test('x-api-key wins when both key headers are present', async () => {
  await withServer(async port => {
    const result = await request(port, '/bookings', { 'x-api-key': 'team-demo', 'x-booking-api-key': 'free-demo' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-limit'], '20');
    assert.equal(result.headers['ratelimit-remaining'], '19');
  }, { config: config() });
});

test('free clients receive 429 after their configured limit', async () => {
  await withServer(async port => {
    for (let i = 0; i < 5; i++) assert.equal((await request(port, '/bookings', key('free-demo'))).status, 200);
    const result = await request(port, '/bookings', key('free-demo'));
    assert.equal(result.status, 429);
    assert.equal(result.headers['ratelimit-remaining'], '0');
    assert.ok(result.headers['retry-after']);
  }, { config: config() });
});

test('team clients use the team plan instead of the default plan', async () => {
  await withServer(async port => {
    for (let i = 0; i < 6; i++) assert.equal((await request(port, '/bookings', key('team-demo'))).status, 200);
    const result = await request(port, '/bookings', key('team-demo'));
    assert.equal(result.headers['ratelimit-limit'], '20');
    assert.equal(result.headers['ratelimit-remaining'], '13');
  }, { config: config() });
});

test('one client quota is shared by the booking routes', async () => {
  await withServer(async port => {
    for (let i = 0; i < 4; i++) assert.equal((await request(port, '/bookings', key('free-demo'))).status, 200);
    const result = await request(port, '/bookings/b-100', key('free-demo'));
    assert.equal(result.status, 200);
    const blocked = await request(port, '/bookings', key('free-demo'));
    assert.equal(blocked.status, 429);
  }, { config: config() });
});

test('retry-after uses the injected clock and the remaining window', async () => {
  let now = 100000;
  await withServer(async port => {
    for (let i = 0; i < 5; i++) await request(port, '/bookings', key('free-demo'));
    now = 105001;
    const result = await request(port, '/bookings', key('free-demo'));
    assert.equal(result.status, 429);
    assert.equal(result.headers['retry-after'], '55');
  }, { config: config({ windowMs: 60000 }), clock: () => now });
});

test('a new window restores the quota without waiting in real time', async () => {
  let now = 5000;
  await withServer(async port => {
    for (let i = 0; i < 5; i++) await request(port, '/bookings', key('free-demo'));
    now = 65000;
    const result = await request(port, '/bookings', key('free-demo'));
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-remaining'], '4');
  }, { config: config({ windowMs: 60000 }), clock: () => now });
});

test('health stays exempt from API-key limiting', async () => {
  await withServer(async port => {
    for (let i = 0; i < 8; i++) {
      const result = await request(port, '/health');
      assert.equal(result.status, 200);
      assert.equal(result.headers['ratelimit-limit'], undefined);
    }
  }, { config: config() });
});

test('readiness stays exempt from API-key limiting', async () => {
  await withServer(async port => {
    const result = await request(port, '/ready');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ready: true });
  }, { config: config() });
});

test('a missing key does not consume the keyed client quota', async () => {
  await withServer(async port => {
    assert.equal((await request(port)).status, 401);
    const result = await request(port, '/bookings', key('free-demo'));
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-remaining'], '4');
  }, { config: config() });
});

test('an unmapped key gets the configured default plan', async () => {
  await withServer(async port => {
    const result = await request(port, '/bookings', key('a-new-client'));
    assert.equal(result.status, 200);
    assert.equal(result.headers['ratelimit-limit'], '5');
  }, { config: config() });
});

test('expired clients are removed before new clients are admitted', async () => {
  let now = 0;
  await withServer(async port => {
    assert.equal((await request(port, '/bookings', key('old-client'))).status, 200);
    now = 1001;
    assert.equal((await request(port, '/bookings', key('new-client'))).status, 200);
    assert.equal((await request(port, '/bookings', key('old-client'))).headers['ratelimit-remaining'], '4');
  }, { config: config({ windowMs: 1000, maxClients: 1 }), clock: () => now });
});

test('the client map stays bounded by evicting the least recently seen key', async () => {
  let now = 0;
  await withServer(async port => {
    assert.equal((await request(port, '/bookings', key('a'))).status, 200);
    assert.equal((await request(port, '/bookings', key('b'))).status, 200);
    assert.equal((await request(port, '/bookings', key('a'))).status, 200);
    assert.equal((await request(port, '/bookings', key('c'))).status, 200);
    const evicted = await request(port, '/bookings', key('b'));
    assert.equal(evicted.status, 200);
    assert.equal(evicted.headers['ratelimit-remaining'], '4');
  }, { config: config({ maxClients: 2 }), clock: () => now });
});
