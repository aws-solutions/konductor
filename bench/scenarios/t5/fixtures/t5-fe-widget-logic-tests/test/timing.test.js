'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { debounce, retry } = require('../src/timing');

function fakeClock() {
  let next = 1;
  const jobs = new Map();
  return {
    setTimeout(callback) { const id = next++; jobs.set(id, callback); return id; },
    clearTimeout(id) { jobs.delete(id); },
    runAll() { for (const [id, callback] of [...jobs]) { jobs.delete(id); callback(); } },
  };
}

test('debounce eventually calls the function', () => {
  const clock = fakeClock();
  let calls = 0;
  debounce(() => { calls += 1; }, 20, clock)();
  clock.runAll();
  assert.equal(calls, 1);
});

test('retry can recover from one transient failure', async () => {
  let attempts = 0;
  const value = await retry(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary');
    return 'ready';
  }, { retries: 2 });
  assert.equal(value, 'ready');
  assert.equal(attempts, 2);
});
