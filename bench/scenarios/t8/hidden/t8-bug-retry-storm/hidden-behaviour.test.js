'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient } = require('./src/shared-http-client');

class FakeClock {
  constructor(now = 0) { this.time = now; this.delays = []; this.timers = []; }
  now() { return this.time; }
  setTimeout(fn, delay) {
    this.delays.push(delay);
    const timer = { at: this.time + delay, fn, cancelled: false };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer) { timer.cancelled = true; }
  runNext() {
    this.timers.sort((a, b) => a.at - b.at);
    const timer = this.timers.shift();
    assert.ok(timer, 'expected a pending timer');
    this.time = timer.at;
    if (!timer.cancelled) timer.fn();
  }
  advance(ms) { this.time += ms; }
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function responseSequence(responses, clock, extra = {}) {
  let index = 0;
  const calls = [];
  const client = createHttpClient({
    clock,
    random: () => 0.5,
    ...extra,
    transport: async (request, meta) => {
      calls.push({ request, meta });
      return responses[Math.min(index++, responses.length - 1)];
    }
  });
  return { client, calls };
}

test('uses the configured millisecond base delay after a 503', async () => {
  const clock = new FakeClock();
  const { client } = responseSequence([{ status: 503, headers: {} }, { status: 200, headers: {} }], clock, { baseDelayMs: 125, jitterRatio: 0 });
  const pending = client.request({ method: 'GET', url: '/orders' });
  await settle();
  assert.deepEqual(clock.delays, [125]);
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 200);
});

test('doubles the exponential delay for the second retry', async () => {
  const clock = new FakeClock();
  const { client } = responseSequence([
    { status: 503, headers: {} }, { status: 503, headers: {} }, { status: 200, headers: {} }
  ], clock, { baseDelayMs: 100, jitterRatio: 0 });
  const pending = client.request({ method: 'GET', url: '/orders' });
  await settle();
  clock.runNext();
  await settle();
  assert.deepEqual(clock.delays, [100, 200]);
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 200);
});

test('honors a numeric Retry-After header', async () => {
  const clock = new FakeClock();
  const { client } = responseSequence([{ status: 429, headers: { 'retry-after': '1.5' } }, { status: 201, headers: {} }], clock, { jitterRatio: 0 });
  const pending = client.request({ method: 'POST', url: '/orders' });
  await settle();
  assert.deepEqual(clock.delays, [1500]);
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 201);
});

test('honors an HTTP-date Retry-After header relative to the injected clock', async () => {
  const clock = new FakeClock(Date.parse('2025-04-01T00:00:00Z'));
  const retryAt = new Date(clock.now() + 2400).toUTCString();
  const { client } = responseSequence([{ status: 503, headers: { 'Retry-After': retryAt } }, { status: 200, headers: {} }], clock, { jitterRatio: 0 });
  const pending = client.request({ method: 'GET', url: '/orders' });
  await settle();
  assert.equal(clock.delays[0], Math.max(0, Date.parse(retryAt) - clock.now()));
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 200);
});

test('keeps random jitter inside the configured range', async () => {
  const clock = new FakeClock();
  const { client } = responseSequence([{ status: 503, headers: {} }, { status: 200, headers: {} }], clock, { baseDelayMs: 1000, jitterRatio: 0.2, random: () => 0 });
  const pending = client.request({ method: 'GET', url: '/orders' });
  await settle();
  assert.equal(clock.delays[0], 800);
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 200);
});

test('does not retry a non-retryable response or swallow a transport error', async () => {
  const clock = new FakeClock();
  const { client, calls } = responseSequence([{ status: 400, headers: {} }], clock);
  const response = await client.request({ method: 'POST', url: '/orders' });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
  assert.deepEqual(clock.delays, []);
  const failing = createHttpClient({ clock, transport: async () => { throw new Error('socket failed'); } });
  await assert.rejects(() => failing.request({ method: 'GET', url: '/orders' }), /socket failed/);
});

test('returns the final retryable response at the attempt limit', async () => {
  const clock = new FakeClock();
  const { client, calls } = responseSequence([{ status: 503, headers: {} }], clock, { maxAttempts: 3, baseDelayMs: 50, jitterRatio: 0 });
  const pending = client.request({ method: 'GET', url: '/orders' });
  await settle();
  clock.runNext();
  await settle();
  assert.deepEqual(clock.delays, [50, 100]);
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 503);
  assert.equal(calls.length, 3);
});

test('opens the circuit after consecutive partner failures and recovers after cooldown', async () => {
  const clock = new FakeClock();
  let calls = 0;
  const client = createHttpClient({
    clock,
    breakerFailureThreshold: 2,
    breakerCooldownMs: 1000,
    maxAttempts: 2,
    baseDelayMs: 100,
    jitterRatio: 0,
    transport: async () => { calls += 1; return { status: calls <= 2 ? 503 : 200, headers: {} }; }
  });
  const failed = client.request({ method: 'GET', url: '/orders' });
  await settle();
  assert.deepEqual(clock.delays, [100]);
  clock.runNext();
  await settle();
  assert.equal((await failed).status, 503);
  await assert.rejects(() => client.request({ method: 'GET', url: '/orders' }), { code: 'CIRCUIT_OPEN' });
  clock.advance(1000);
  assert.equal((await client.request({ method: 'GET', url: '/orders' })).status, 200);
});

test('calls the supplied limiter before each transport attempt', async () => {
  const clock = new FakeClock();
  const waits = [];
  const limiter = { take: async (suppliedClock) => waits.push(suppliedClock === clock) };
  const { client } = responseSequence([{ status: 503, headers: {} }, { status: 200, headers: {} }], clock, { limiter, jitterRatio: 0 });
  const pending = client.request({ method: 'GET', url: '/orders' });
  await settle();
  assert.deepEqual(clock.delays, [250]);
  clock.runNext();
  await settle();
  assert.equal((await pending).status, 200);
  assert.deepEqual(waits, [true, true]);
});

test('passes the same request object and one-based attempt metadata to transport', async () => {
  const clock = new FakeClock();
  const { client, calls } = responseSequence([{ status: 503, headers: {} }, { status: 200, headers: {} }], clock, { jitterRatio: 0 });
  const request = { method: 'PUT', url: '/orders/42', headers: { trace: 'abc' }, body: '{}' };
  const pending = client.request(request);
  await settle();
  assert.deepEqual(clock.delays, [250]);
  clock.runNext();
  await settle();
  await pending;
  assert.equal(calls[0].request, request);
  assert.deepEqual(calls.map((call) => call.meta.attempt), [1, 2]);
});
