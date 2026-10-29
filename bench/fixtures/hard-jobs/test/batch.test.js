'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runBatch, createDedupeStore } = require('../src');
const { ev, fakeClock } = require('./helpers');

const noSleep = async () => {};

test('totals amounts per customer', async () => {
  const r = await runBatch([ev('a1', 'ann', 100), ev('a2', 'ann', 250), ev('b1', 'bob', 5)], { handle: async () => {}, sleep: noSleep });
  assert.deepEqual(r.totals, { ann: 350, bob: 5 });
  assert.equal(r.processed, 3);
});

test('retries a transient failure', async () => {
  let calls = 0;
  const handle = async () => { calls += 1; if (calls === 1) throw new Error('timeout'); };
  const r = await runBatch([ev('r1', 'retry-user')], { handle, maxRetries: 2, retryDelayMs: 10, sleep: noSleep });
  assert.equal(r.processed, 1);
  assert.equal(calls, 2);
});

test('reports an event that keeps failing', async () => {
  const r = await runBatch([ev('f1', 'fail-user')], { handle: async () => { throw new Error('down'); }, maxRetries: 1, sleep: noSleep });
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, 'f1');
  assert.equal(r.failed[0].message, 'down');
});

test('skips events already handled by a shared dedupe store', async () => {
  const clock = fakeClock(1000);
  const dedupe = createDedupeStore({ clock, ttlMs: 60000 });
  const seen = [];
  const handle = async (e) => { seen.push(e.id); };
  await runBatch([ev('d1', 'dedupe-user')], { handle, dedupe, sleep: noSleep });
  clock.advance(1000);
  const r = await runBatch([ev('d1', 'dedupe-user')], { handle, dedupe, sleep: noSleep });
  assert.equal(r.duplicates, 1);
  assert.deepEqual(seen, ['d1']);
});

test('concurrency 1 handles events in input order', async () => {
  const order = [];
  await runBatch([ev('o1', 'order-user'), ev('o2', 'order-user'), ev('o3', 'order-user')], {
    handle: async (e) => { order.push(e.id); }, concurrency: 1, sleep: noSleep,
  });
  assert.deepEqual(order, ['o1', 'o2', 'o3']);
});

test('rejects a bad concurrency', async () => {
  await assert.rejects(runBatch([], { handle: async () => {}, concurrency: 0 }), RangeError);
});
