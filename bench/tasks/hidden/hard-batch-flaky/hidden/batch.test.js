'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runBatch, createDedupeStore } = require('../src');

const ev = (id, customerId = 'c1', amountCents = 100) => ({ id, customerId, amountCents, ts: 0 });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance(ms) { t += ms; }, set(v) { t = v; } };
}

function recorder() {
  const delays = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
}

function tracker(ms = 4) {
  let cur = 0;
  const t = { max: 0, calls: new Map(), order: [] };
  t.handle = async (e) => {
    cur += 1;
    t.max = Math.max(t.max, cur);
    t.order.push(e.id);
    t.calls.set(e.id, (t.calls.get(e.id) || 0) + 1);
    await tick(ms);
    cur -= 1;
  };
  return t;
}

const ok = async () => {};

test('an empty batch gives an empty result', async () => {
  assert.deepEqual(await runBatch([], { handle: ok }), { totals: {}, processed: 0, duplicates: 0, failed: [] });
});

test('totals are summed per customer in cents, negative amounts included', async () => {
  const r = await runBatch([ev('1', 'a', 1999), ev('2', 'a', -500), ev('3', 'b', 0), ev('4', 'a', 1)], { handle: ok, sleep: ok });
  assert.deepEqual(r.totals, { a: 1500, b: 0 });
  assert.equal(r.processed, 4);
});

test('every call starts from empty totals', async () => {
  const first = await runBatch([ev('1', 'x', 10)], { handle: ok });
  const second = await runBatch([ev('2', 'y', 5)], { handle: ok });
  const third = await runBatch([], { handle: ok });
  assert.deepEqual(second.totals, { y: 5 });
  assert.deepEqual(third.totals, {});
  assert.deepEqual(first.totals, { x: 10 }, 'an earlier result is not changed by later calls');
});

test('a result object is not shared with the next call', async () => {
  const a = await runBatch([ev('1', 'z', 1)], { handle: ok });
  const b = await runBatch([ev('2', 'z', 1)], { handle: ok });
  assert.notEqual(a.totals, b.totals);
  assert.equal(a.totals.z, 1);
  assert.equal(b.totals.z, 1);
});

test('an event is attempted 1 + maxRetries times with doubling delays', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const r = await runBatch([ev('f')], { handle: async () => { calls += 1; throw new Error('timeout'); }, maxRetries: 3, retryDelayMs: 200, sleep });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [200, 400, 800]);
  assert.deepEqual(r.failed, [{ id: 'f', attempts: 4, message: 'timeout' }]);
  assert.equal(r.processed, 0);
});

test('an event that fails three times succeeds on the fourth attempt', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const r = await runBatch([ev('s', 'c', 700)], { handle: async () => { calls += 1; if (calls <= 3) throw new Error('flaky'); }, maxRetries: 3, retryDelayMs: 50, sleep });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [50, 100, 200]);
  assert.deepEqual(r.totals, { c: 700 });
  assert.deepEqual(r.failed, []);
});

test('maxRetries 0 means a single attempt and no waiting', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  const r = await runBatch([ev('f')], { handle: async () => { calls += 1; throw new Error('no'); }, maxRetries: 0, sleep });
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(r.failed[0].attempts, 1);
});

test('the defaults are 3 retries starting at 200 ms', async () => {
  const { delays, sleep } = recorder();
  let calls = 0;
  await runBatch([ev('f')], { handle: async () => { calls += 1; throw new Error('no'); }, sleep });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [200, 400, 800]);
});

test('a non-Error rejection is reported with String()', async () => {
  const r = await runBatch([ev('f')], { handle: async () => { throw 'plain text'; }, maxRetries: 0 });
  assert.equal(r.failed[0].message, 'plain text');
});

test('failed events are listed in input order whatever order they finish in', async () => {
  const delays = { a: 30, b: 1, c: 15, d: 1 };
  const handle = async (e) => { await tick(delays[e.id]); throw new Error(`bad ${e.id}`); };
  const r = await runBatch(['a', 'b', 'c', 'd'].map((id) => ev(id)), { handle, concurrency: 4, maxRetries: 0 });
  assert.deepEqual(r.failed.map((f) => f.id), ['a', 'b', 'c', 'd']);
});

test('one failing event does not stop the others', async () => {
  const handle = async (e) => { if (e.id === 'bad') throw new Error('x'); };
  const r = await runBatch([ev('1', 'c', 5), ev('bad', 'c', 7), ev('2', 'c', 11)], { handle, maxRetries: 0 });
  assert.deepEqual(r.totals, { c: 16 });
  assert.equal(r.processed, 2);
  assert.equal(r.failed.length, 1);
});

test('at most `concurrency` handlers run at once and each event runs once', async () => {
  const t = tracker();
  const events = Array.from({ length: 10 }, (_, i) => ev(`e${i}`, 'c', 1));
  const r = await runBatch(events, { handle: t.handle, concurrency: 3 });
  assert.equal(t.max, 3);
  assert.equal(r.processed, 10);
  assert.equal(r.totals.c, 10);
  assert.deepEqual([...t.calls.values()], Array(10).fill(1));
});

test('the default concurrency is 4', async () => {
  const t = tracker();
  await runBatch(Array.from({ length: 12 }, (_, i) => ev(`e${i}`)), { handle: t.handle });
  assert.equal(t.max, 4);
});

test('concurrency 1 runs events one at a time in input order', async () => {
  const t = tracker(1);
  await runBatch(['a', 'b', 'c', 'd'].map((id) => ev(id)), { handle: t.handle, concurrency: 1 });
  assert.equal(t.max, 1);
  assert.deepEqual(t.order, ['a', 'b', 'c', 'd']);
});

test('a bad concurrency throws RangeError', async () => {
  for (const concurrency of [0, -2, 1.5, '3', NaN]) {
    await assert.rejects(runBatch([ev('1')], { handle: ok, concurrency }), RangeError, String(concurrency));
  }
});

test('options given to one call do not change later calls', async () => {
  const t1 = tracker();
  await runBatch(Array.from({ length: 8 }, (_, i) => ev(`a${i}`)), { handle: t1.handle, concurrency: 1, maxRetries: 0 });
  const t2 = tracker();
  await runBatch(Array.from({ length: 8 }, (_, i) => ev(`b${i}`)), { handle: t2.handle });
  assert.equal(t1.max, 1);
  assert.equal(t2.max, 4);
  let calls = 0;
  await runBatch([ev('x')], { handle: async () => { calls += 1; throw new Error('n'); }, sleep: ok });
  assert.equal(calls, 4);
});

test('the same id twice in a batch is handled once, even when both could start together', async () => {
  const t = tracker(8);
  const r = await runBatch([ev('same', 'c', 100), ev('same', 'c', 100), ev('other', 'c', 1)], { handle: t.handle, concurrency: 4 });
  assert.equal(t.calls.get('same'), 1);
  assert.equal(r.duplicates, 1);
  assert.equal(r.processed, 2);
  assert.deepEqual(r.totals, { c: 101 });
});

test('a later event with the same id is a duplicate even if the first one fails for good', async () => {
  const seen = [];
  const handle = async (e) => { seen.push(e.id); throw new Error('no'); };
  const r = await runBatch([ev('same'), ev('same')], { handle, concurrency: 1, maxRetries: 1, sleep: ok });
  assert.deepEqual(seen, ['same', 'same'], 'two attempts of the first event only');
  assert.equal(r.duplicates, 1);
  assert.equal(r.failed.length, 1);
});

test('a shared dedupe store skips events handled by an earlier batch', async () => {
  const clock = fakeClock(1000);
  const dedupe = createDedupeStore({ clock });
  const t = tracker(1);
  await runBatch([ev('a'), ev('b')], { handle: t.handle, dedupe });
  clock.advance(60000);
  const r = await runBatch([ev('a'), ev('b'), ev('c')], { handle: t.handle, dedupe });
  assert.equal(r.duplicates, 2);
  assert.equal(r.processed, 1);
  assert.deepEqual(r.totals, { c1: 100 });
  assert.deepEqual([...t.calls.entries()], [['a', 1], ['b', 1], ['c', 1]]);
});

test('without a store there is no memory between calls', async () => {
  const t = tracker(1);
  await runBatch([ev('a')], { handle: t.handle });
  const r = await runBatch([ev('a')], { handle: t.handle });
  assert.equal(r.duplicates, 0);
  assert.equal(t.calls.get('a'), 2);
});

test('the default ttl is one hour and an id is forgotten at exactly the ttl', async () => {
  const clock = fakeClock(5000);
  const dedupe = createDedupeStore({ clock });
  const t = tracker(1);
  await runBatch([ev('a', 'c', 10)], { handle: t.handle, dedupe });
  clock.advance(3599999);
  assert.equal((await runBatch([ev('a', 'c', 10)], { handle: t.handle, dedupe })).duplicates, 1);
  clock.set(5000 + 3600000);
  const r = await runBatch([ev('a', 'c', 10)], { handle: t.handle, dedupe });
  assert.equal(r.duplicates, 0);
  assert.deepEqual(r.totals, { c: 10 });
  assert.equal(t.calls.get('a'), 2);
});

test('an expired id is handled again even when nothing else touched the store', async () => {
  const clock = fakeClock(0);
  const dedupe = createDedupeStore({ clock, ttlMs: 1000 });
  const t = tracker(1);
  await runBatch([ev('only')], { handle: t.handle, dedupe });
  clock.advance(999);
  assert.equal((await runBatch([ev('only')], { handle: t.handle, dedupe })).duplicates, 1);
  clock.advance(1);
  assert.equal((await runBatch([ev('only')], { handle: t.handle, dedupe })).duplicates, 0);
});

test('the ttl counts from the time the event was handled, not from the last duplicate seen', async () => {
  const clock = fakeClock(0);
  const dedupe = createDedupeStore({ clock, ttlMs: 1000 });
  await runBatch([ev('k')], { handle: ok, dedupe });
  clock.advance(600);
  await runBatch([ev('k')], { handle: ok, dedupe });
  clock.advance(400);
  assert.equal((await runBatch([ev('k')], { handle: ok, dedupe })).duplicates, 0);
});

test('an event that failed for good is handled again in a later batch', async () => {
  const dedupe = createDedupeStore({ clock: fakeClock(0) });
  const failing = await runBatch([ev('e1', 'c', 9)], { handle: async () => { throw new Error('down'); }, dedupe, maxRetries: 1, sleep: ok });
  assert.equal(failing.failed.length, 1);
  const retry = await runBatch([ev('e1', 'c', 9)], { handle: ok, dedupe });
  assert.equal(retry.duplicates, 0);
  assert.deepEqual(retry.totals, { c: 9 });
});

test('successful events are remembered even when others in the batch fail', async () => {
  const dedupe = createDedupeStore({ clock: fakeClock(0) });
  await runBatch([ev('good'), ev('bad')], { handle: async (e) => { if (e.id === 'bad') throw new Error('x'); }, dedupe, maxRetries: 0 });
  const r = await runBatch([ev('good'), ev('bad')], { handle: ok, dedupe });
  assert.equal(r.duplicates, 1);
  assert.equal(r.processed, 1);
});

test('a large noisy batch matches a simple model', async () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const events = [];
  const expected = {};
  const failsFor = new Map();
  for (let i = 0; i < 160; i++) {
    const id = `ev${i % 140}`;
    const e = { id, customerId: `c${Math.floor(rnd() * 7)}`, amountCents: Math.floor(rnd() * 20000) - 5000, ts: i };
    events.push(e);
    if (!failsFor.has(id)) failsFor.set(id, [0, 1, 2, 3, 3, 9][Math.floor(rnd() * 6)]);
  }
  const seenIds = new Set();
  for (const e of events) {
    if (seenIds.has(e.id)) continue;
    seenIds.add(e.id);
    if (failsFor.get(e.id) <= 3) expected[e.customerId] = (expected[e.customerId] || 0) + e.amountCents;
  }
  const attempts = new Map();
  const delays = new Map();
  const handle = async (e) => {
    const n = (attempts.get(e.id) || 0) + 1;
    attempts.set(e.id, n);
    await tick(delays.get(e.id) ?? (delays.set(e.id, Math.floor(rnd() * 4)), delays.get(e.id)));
    if (n <= failsFor.get(e.id)) throw new Error(`fail ${e.id}`);
  };
  const r = await runBatch(events, { handle, concurrency: 5, maxRetries: 3, sleep: ok });
  const unique = [...seenIds];
  assert.deepEqual(r.totals, expected);
  assert.equal(r.duplicates, 20);
  assert.equal(r.processed, unique.filter((id) => failsFor.get(id) <= 3).length);
  assert.deepEqual(r.failed.map((f) => f.id), unique.filter((id) => failsFor.get(id) > 3));
  assert.ok(r.failed.every((f) => f.attempts === 4));
  for (const id of unique) assert.equal(attempts.get(id), Math.min(failsFor.get(id) + 1, 4), id);
});
