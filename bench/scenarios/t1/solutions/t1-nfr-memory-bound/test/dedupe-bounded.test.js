const test = require('node:test');
const assert = require('node:assert/strict');
const { DedupeStore } = require('../src/dedupe-store');

function makeClock() {
  let now = 0;
  return { now: () => now, advance: ms => { now += ms; } };
}

test('reports the store limits', () => {
  const clock = makeClock();
  const store = new DedupeStore({ clock: clock.now });
  assert.deepEqual(store.stats(), {
    remembered: 0, max: 3, windowMs: 60000, evictions: 0, expirations: 0
  });
});

test('treats case and surrounding whitespace as the same key', () => {
  const store = new DedupeStore({ clock: () => 0 });
  assert.equal(store.remember('  Delivery-7 '), true);
  assert.equal(store.remember('delivery-7'), false);
});

test('does not extend a key lifetime when it is retried', () => {
  const clock = makeClock();
  const store = new DedupeStore({ clock: clock.now });
  store.remember('delivery-7');
  clock.advance(59999);
  assert.equal(store.remember('delivery-7'), false);
  clock.advance(1);
  assert.equal(store.has('delivery-7'), false);
});

test('evicts the oldest key at the entry limit', () => {
  const store = new DedupeStore({ clock: () => 0 });
  store.remember('one');
  store.remember('two');
  store.remember('three');
  store.remember('four');
  assert.equal(store.has('one'), false);
  assert.equal(store.stats().evictions, 1);
});

test('expires entries before counting a capacity eviction', () => {
  const clock = makeClock();
  const store = new DedupeStore({ clock: clock.now });
  store.remember('one');
  clock.advance(60000);
  store.remember('two');
  assert.deepEqual(store.stats(), {
    remembered: 1, max: 3, windowMs: 60000, evictions: 0, expirations: 1
  });
});
