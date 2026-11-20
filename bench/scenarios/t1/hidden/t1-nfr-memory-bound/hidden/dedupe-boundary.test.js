const test = require('node:test');
const assert = require('node:assert/strict');
const { DedupeStore } = require('../src/dedupe-store');

function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: ms => { time += ms; } };
}

function storeWith(c) {
  return new DedupeStore({ clock: c.now });
}

test('reports the configured bound and window in its stats shape', () => {
  const c = clock();
  assert.deepEqual(storeWith(c).stats(), {
    remembered: 0,
    max: 3,
    windowMs: 60000,
    evictions: 0,
    expirations: 0
  });
});

test('normalizes case and surrounding whitespace for remember and has', () => {
  const c = clock();
  const store = storeWith(c);
  assert.equal(store.remember('  Event-A  '), true);
  assert.equal(store.remember('event-a'), false);
  assert.equal(store.has(' EVENT-A'), true);
  assert.equal(store.size(), 1);
});

test('keeps a duplicate within the sixty second window', () => {
  const c = clock();
  const store = storeWith(c);
  store.remember('event-a');
  c.advance(59999);
  assert.equal(store.remember('EVENT-A'), false);
});

test('allows a key to be remembered again at the window boundary', () => {
  const c = clock();
  const store = storeWith(c);
  store.remember('event-a');
  c.advance(60000);
  assert.equal(store.remember('event-a'), true);
  assert.equal(store.stats().expirations, 1);
});

test('a duplicate does not refresh its age', () => {
  const c = clock();
  const store = storeWith(c);
  store.remember('event-a');
  c.advance(59999);
  assert.equal(store.remember('event-a'), false);
  c.advance(1);
  assert.equal(store.has('event-a'), false);
  assert.equal(store.stats().expirations, 1);
});
