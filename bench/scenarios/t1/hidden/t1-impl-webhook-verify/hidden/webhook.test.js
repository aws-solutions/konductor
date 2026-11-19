const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { createServer } = require('../src/server');
const { loadConfig } = require('../src/config');

const NOW = 1_700_000_000;
const PRIMARY = 'primary-for-tests';
const SECONDARY = 'secondary-for-tests';

function bodyFor(id = 'evt-1', amount = 1250) {
  return JSON.stringify({ id, type: 'charge.succeeded', amount, currency: 'usd' });
}

function signature(body, timestamp, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function send(server, { body, header, method = 'POST', path = '/webhooks/payment' } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({ port: address.port, method, path, headers: {
      ...(header === undefined ? {} : { 'payment-signature': header }),
      'content-type': 'application/json'
    } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function withServer(options, callback) {
  const server = createServer({ ...options, clock: () => NOW });
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    return await callback(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function signed(body, timestamp = NOW, secret = PRIMARY) {
  return `t=${timestamp},v1=${signature(body, timestamp, secret)}`;
}

test('accepts a primary-secret callback and rejects its altered body', async () => {
  const body = bodyFor('evt-primary');
  await withServer({ secrets: [PRIMARY], toleranceSeconds: 300 }, async (server) => {
    assert.equal((await send(server, { body, header: signed(body) })).status, 200);
    const altered = body.replace('1250', '1251');
    const rejected = await send(server, { body: altered, header: signed(body) });
    assert.equal(rejected.status, 401);
    assert.deepEqual(rejected.body, { error: 'unauthorized' });
  });
});

test('accepts the secondary secret during key rotation and rejects no-header requests', async () => {
  const body = bodyFor('evt-secondary');
  await withServer({ secrets: [PRIMARY, SECONDARY] }, async (server) => {
    assert.equal((await send(server, { body, header: signed(body, NOW, SECONDARY) })).status, 200);
    const rejected = await send(server, { body });
    assert.equal(rejected.status, 401);
    assert.deepEqual(rejected.body, { error: 'unauthorized' });
  });
});

test('checks every v1 value and accepts one valid value among them', async () => {
  const body = bodyFor('evt-multiple');
  const valid = signature(body, NOW, SECONDARY);
  await withServer({ secrets: [PRIMARY, SECONDARY] }, async (server) => {
    const response = await send(server, { body, header: `t=${NOW},v1=${'00'.repeat(32)},v1=${valid}` });
    assert.equal(response.status, 200);
    const malformed = await send(server, { body, header: `t=${NOW},v1=${'00'.repeat(32)}` });
    assert.equal(malformed.status, 401);
  });
});

test('signs the exact raw body rather than parsed JSON', async () => {
  const body = '{ "currency": "usd", "amount": 1250, "id": "evt-raw", "type": "charge.succeeded" }';
  await withServer({ secrets: [PRIMARY] }, async (server) => {
    assert.equal((await send(server, { body, header: signed(body) })).status, 200);
    const normalized = JSON.stringify(JSON.parse(body));
    const rejected = await send(server, { body: normalized, header: signed(body) });
    assert.equal(rejected.status, 401);
  });
});

test('uses the same generic response for missing and malformed authentication', async () => {
  await withServer({ secrets: [PRIMARY] }, async (server) => {
    const missing = await send(server, { body: bodyFor('evt-missing') });
    const malformed = await send(server, { body: bodyFor('evt-malformed'), header: 't=not-a-time,v1=nope' });
    assert.equal(missing.status, 401);
    assert.equal(malformed.status, 401);
    assert.deepEqual(missing.body, malformed.body);
  });
});

test('rejects signatures outside the replay window in both directions', async () => {
  const body = bodyFor('evt-window');
  await withServer({ secrets: [PRIMARY], toleranceSeconds: 30 }, async (server) => {
    const old = await send(server, { body, header: signed(body, NOW - 31) });
    const future = await send(server, { body, header: signed(body, NOW + 31) });
    assert.equal(old.status, 401);
    assert.equal(future.status, 401);
  });
});

test('accepts the exact replay-window boundary with an injected clock', async () => {
  const body = bodyFor('evt-boundary');
  await withServer({ secrets: [PRIMARY], toleranceSeconds: 30 }, async (server) => {
    const response = await send(server, { body, header: signed(body, NOW - 30) });
    assert.equal(response.status, 200);
  });
});

test('returns a request error for signed malformed JSON, but authentication errors stay unauthorized', async () => {
  await withServer({ secrets: [PRIMARY] }, async (server) => {
    const malformed = '{"id":"evt-bad",';
    const badJson = await send(server, { body: malformed, header: signed(malformed) });
    const noAuth = await send(server, { body: malformed });
    assert.equal(badJson.status, 400);
    assert.deepEqual(badJson.body, { error: 'invalid_request' });
    assert.equal(noAuth.status, 401);
  });
});

test('returns a request error for an authenticated event without an id', async () => {
  const body = JSON.stringify({ amount: 4, currency: 'usd' });
  await withServer({ secrets: [PRIMARY] }, async (server) => {
    const response = await send(server, { body, header: signed(body) });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'invalid_request' });
    const noAuth = await send(server, { body });
    assert.equal(noAuth.status, 401);
  });
});

test('acknowledges duplicate ids without applying the amount twice', async () => {
  const body = bodyFor('evt-duplicate', 900);
  await withServer({ secrets: [PRIMARY] }, async (server) => {
    const first = await send(server, { body, header: signed(body) });
    const second = await send(server, { body, header: signed(body) });
    assert.deepEqual(first.body, { ok: true, duplicate: false });
    assert.deepEqual(second.body, { ok: true, duplicate: true });
    const ledger = await send(server, { method: 'GET', path: '/ledger' });
    assert.equal(ledger.body.balance, 900);
    assert.deepEqual(ledger.body.eventIds, ['evt-duplicate']);
    const noAuth = await send(server, { body });
    assert.equal(noAuth.status, 401);
  });
});

test('loads both configured secrets and a nonnegative tolerance from environment', () => {
  const config = loadConfig({ PORT: '8123', LEDGER_LABEL: 'x', WEBHOOK_SECRET_PRIMARY: 'a', WEBHOOK_SECRET_SECONDARY: 'b', WEBHOOK_TOLERANCE_SECONDS: '45' });
  assert.deepEqual(config.webhookSecrets, ['a', 'b']);
  assert.equal(config.webhookToleranceSeconds, 45);
});

test('rejects a signature with an invalid digest length', async () => {
  const body = bodyFor('evt-length');
  await withServer({ secrets: [PRIMARY] }, async (server) => {
    const response = await send(server, { body, header: `t=${NOW},v1=abcd` });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'unauthorized' });
    const noAuth = await send(server, { body });
    assert.equal(noAuth.status, 401);
  });
});

test('health remains available without webhook credentials', async () => {
  await withServer({ secrets: [] }, async (server) => {
    const response = await send(server, { method: 'GET', path: '/health' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok', service: 'harbor-payments' });
  });
});

test('refuses callbacks when no webhook secret is configured', async () => {
  const body = bodyFor('evt-no-secret');
  await withServer({ secrets: [] }, async (server) => {
    const response = await send(server, { body, header: signed(body) });
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'unauthorized' });
  });
});
