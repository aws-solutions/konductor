const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

test('a POST booking consumes the same quota as a GET booking', async () => {
  const config = { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json', rateLimit: { windowMs: 60000, maxClients: 10, defaultPlan: 'free', plans: { free: { limit: 1 } }, keyPlans: {} } };
  const server = http.createServer(createApp({ config }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const first = await call(port, 'GET', '/bookings');
    assert.equal(first.status, 401);
    const created = await call(port, 'POST', '/bookings', { room: 'Pine', date: '2025-08-01', owner: 'Jo' }, { 'x-api-key': 'one' });
    assert.equal(created.status, 201);
    const second = await call(port, 'GET', '/bookings', undefined, { 'x-api-key': 'one' });
    assert.equal(second.status, 429);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function call(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body && JSON.stringify(body);
    const request = http.request({ hostname: '127.0.0.1', port, method, path, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
