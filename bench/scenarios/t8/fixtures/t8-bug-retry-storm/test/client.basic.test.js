'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient } = require('../src/shared-http-client');

function immediateClock() {
  return { now: () => 0, setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {} };
}

test('returns a successful partner response', async () => {
  const calls = [];
  const client = createHttpClient({
    clock: immediateClock(),
    transport: async (request, meta) => { calls.push({ request, meta }); return { status: 200, headers: {}, body: 'ok' }; }
  });
  const response = await client.request({ method: 'GET', url: '/health' });
  assert.equal(response.status, 200);
  assert.equal(calls[0].meta.attempt, 1);
});

test('does not retry a client error', async () => {
  let count = 0;
  const client = createHttpClient({
    clock: immediateClock(),
    transport: async () => { count += 1; return { status: 400, headers: {}, body: 'bad request' }; }
  });
  const response = await client.request({ method: 'POST', url: '/orders' });
  assert.equal(response.status, 400);
  assert.equal(count, 1);
});

test('stops after the configured attempt count', async () => {
  let count = 0;
  const client = createHttpClient({
    maxAttempts: 2,
    clock: immediateClock(),
    random: () => 0.5,
    transport: async () => { count += 1; return { status: 503, headers: {}, body: 'busy' }; }
  });
  const response = await client.request({ method: 'GET', url: '/orders' });
  assert.equal(response.status, 503);
  assert.equal(count, 2);
});
