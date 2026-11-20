const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

const config = {
  serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json',
  rateLimit: { windowMs: 60000, maxClients: 100, defaultPlan: 'free', plans: { free: { limit: 5 }, team: { limit: 20 } }, keyPlans: { 'team-demo': 'team' } }
};

async function withServer(run) {
  const server = http.createServer(createApp({ config }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function call(port, method, path, headers = {}, rawBody) {
  return new Promise((resolve, reject) => {
    const sendHeaders = rawBody === undefined ? headers : { 'content-type': 'application/json', ...headers };
    const req = http.request({ hostname: '127.0.0.1', port, method, path, headers: sendHeaders }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

test('a keyless POST with a malformed body is refused as a missing key', async () => {
  await withServer(async port => {
    const result = await call(port, 'POST', '/bookings', {}, '{not json');
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'missing_api_key');
  });
});

test('a keyed POST with a malformed body still reports its rate limit headers', async () => {
  await withServer(async port => {
    const result = await call(port, 'POST', '/bookings', { 'x-api-key': 'free-demo' }, '{not json');
    assert.ok(result.status >= 400 && result.status < 500);
    assert.equal(result.headers['ratelimit-limit'], '5');
    assert.ok(result.headers['ratelimit-remaining'] !== undefined);
  });
});
