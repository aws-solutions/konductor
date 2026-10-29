'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runBatch, createDedupeStore } = require('../src');
const { ev, fakeClock } = require('./helpers');

const noSleep = async () => {};

test('an event gets one attempt plus maxRetries retries', async () => {
  let calls = 0;
  const r = await runBatch([ev('x1', 'reg-a')], { handle: async () => { calls += 1; throw new Error('no'); }, maxRetries: 3, sleep: noSleep });
  assert.equal(calls, 4);
  assert.equal(r.failed[0].attempts, 4);
});

test('the same id in one batch is handled once even with concurrent workers', async () => {
  let calls = 0;
  const handle = async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); };
  const r = await runBatch([ev('dup', 'reg-b'), ev('dup', 'reg-b')], { handle, concurrency: 2, sleep: noSleep });
  assert.equal(calls, 1);
  assert.equal(r.duplicates, 1);
});

test('totals do not carry over between calls', async () => {
  const first = await runBatch([ev('t1', 'reg-c', 10)], { handle: async () => {}, sleep: noSleep });
  const second = await runBatch([ev('t2', 'reg-d', 5)], { handle: async () => {}, sleep: noSleep });
  assert.deepEqual(first.totals, { 'reg-c': 10 });
  assert.deepEqual(second.totals, { 'reg-d': 5 });
});

test('an id is forgotten after the ttl and the default ttl is one hour', async () => {
  const clock = fakeClock(0);
  const store = createDedupeStore({ clock });
  store.mark('e');
  clock.advance(3599999);
  assert.equal(store.has('e'), true);
  clock.advance(1);
  assert.equal(store.has('e'), false);
});
