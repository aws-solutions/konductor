const test = require('node:test');
const assert = require('node:assert/strict');
const { DedupeStore } = require('../src/dedupe-store');

function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: ms => { time += ms; } };
}

function makeStore(c) {
  return new DedupeStore({ clock: c.now });
}

test('keeps no more than three remembered keys', () => {
  const c = clock();
  const store = makeStore(c);
  for (let i = 0; i < 20; i += 1) store.remember(`key-${i}`);
  assert.equal(store.size(), 3);
  assert.equal(store.stats().remembered, 3);
});

test('evicts the oldest retained key when capacity is reached', () => {
  const c = clock();
  const store = makeStore(c);
  store.remember('old');
  c.advance(10);
  store.remember('middle');
  c.advance(10);
  store.remember('new');
  c.advance(10);
  assert.equal(store.remember('fourth'), true);
  assert.equal(store.has('old'), false);
  assert.equal(store.has('middle'), true);
  assert.equal(store.has('new'), true);
  assert.equal(store.stats().evictions, 1);
});

test('uses insertion order to break equal timestamp eviction ties', () => {
  const c = clock();
  const store = makeStore(c);
  store.remember('first');
  store.remember('second');
  store.remember('third');
  store.remember('fourth');
  assert.equal(store.has('first'), false);
  assert.equal(store.has('second'), true);
  assert.equal(store.has('third'), true);
  assert.equal(store.has('fourth'), true);
});

test('expires old entries before applying the capacity eviction', () => {
  const c = clock();
  const store = makeStore(c);
  store.remember('old');
  c.advance(1000);
  store.remember('middle');
  c.advance(1000);
  store.remember('new');
  c.advance(58000);
  store.remember('replacement');
  assert.equal(store.has('old'), false);
  assert.equal(store.has('middle'), true);
  assert.equal(store.has('new'), true);
  assert.equal(store.has('replacement'), true);
  assert.equal(store.stats().expirations, 1);
  assert.equal(store.stats().evictions, 0);
});

test('repeated stats calls do not count the same expiration twice', () => {
  const c = clock();
  const store = makeStore(c);
  store.remember('event');
  c.advance(60000);
  assert.equal(store.stats().expirations, 1);
  assert.equal(store.stats().expirations, 1);
});
