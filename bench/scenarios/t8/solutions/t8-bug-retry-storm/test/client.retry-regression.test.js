'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient } = require('../src/shared-http-client');

class FakeClock {
  constructor() { this.time = 0; this.delays = []; this.timers = []; }
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
    this.time = timer.at;
    if (!timer.cancelled) timer.fn();
  }
}

async function settleMicrotasks() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test('waits for the partner Retry-After value in milliseconds', async () => {
  const clock = new FakeClock();
  let attempts = 0;
  const client = createHttpClient({
    clock,
    jitterRatio: 0,
    transport: async () => {
      attempts += 1;
      return attempts === 1
        ? { status: 429, headers: { 'Retry-After': '2' } }
        : { status: 200, headers: {} };
    }
  });
  const pending = client.request({ method: 'GET', url: '/v1/orders' });
  await settleMicrotasks();
  assert.deepEqual(clock.delays, [2000]);
  clock.runNext();
  await settleMicrotasks();
  assert.equal((await pending).status, 200);
});
