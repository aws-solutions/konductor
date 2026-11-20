const test = require('node:test');
const assert = require('node:assert/strict');
const { DedupeStore } = require('../src/dedupe-store');

test('remembers a key once', () => {
  const store = new DedupeStore({ clock: () => 10 });
  assert.equal(store.remember('event-1'), true);
  assert.equal(store.remember('event-1'), false);
  assert.equal(store.has('event-1'), true);
  assert.equal(store.size(), 1);
});

test('stores more than one independent key', () => {
  const store = new DedupeStore({ clock: () => 10 });
  assert.equal(store.remember('one'), true);
  assert.equal(store.remember('two'), true);
  assert.equal(store.size(), 2);
});

test('normalizes keys by trimming whitespace and ignoring case', () => {
  const store = new DedupeStore({ clock: () => 10 });
  assert.equal(store.remember('  Key  '), true);
  assert.equal(store.remember('KEY'), false);
  assert.equal(store.remember('  key'), false);
  assert.equal(store.has('Key'), true);
  assert.equal(store.has('  KEY  '), true);
});

test('remembers at most 3 keys', () => {
  const store = new DedupeStore({ clock: () => 10 });
  assert.equal(store.remember('a'), true);
  assert.equal(store.remember('b'), true);
  assert.equal(store.remember('c'), true);
  assert.equal(store.remember('d'), true);
  assert.equal(store.size(), 3);
});

test('evicts oldest key when at capacity', () => {
  const store = new DedupeStore({ clock: () => 10 });
  store.remember('a');
  store.remember('b');
  store.remember('c');
  store.remember('d');
  assert.equal(store.has('a'), false);
  assert.equal(store.has('b'), true);
  assert.equal(store.has('c'), true);
  assert.equal(store.has('d'), true);
});

test('evicts by insertion order when timestamps are equal', () => {
  const store = new DedupeStore({ clock: () => 10 });
  store.remember('first');
  store.remember('second');
  store.remember('third');
  store.remember('fourth');
  assert.equal(store.has('first'), false);
});

test('expires keys older than 60000ms', () => {
  let time = 0;
  const store = new DedupeStore({ clock: () => time });
  time = 0;
  store.remember('old');
  time = 60001;
  assert.equal(store.remember('new'), true);
  assert.equal(store.has('old'), false);
  assert.equal(store.has('new'), true);
});

test('duplicate does not refresh age', () => {
  let time = 0;
  const store = new DedupeStore({ clock: () => time });
  time = 0;
  store.remember('key');
  time = 30000;
  assert.equal(store.remember('key'), false);
  time = 60001;
  assert.equal(store.has('key'), false);
});

test('expired key can be re-remembered', () => {
  let time = 0;
  const store = new DedupeStore({ clock: () => time });
  time = 0;
  assert.equal(store.remember('key'), true);
  time = 60001;
  assert.equal(store.remember('key'), true);
});

test('expires before capacity eviction', () => {
  let time = 0;
  const store = new DedupeStore({ clock: () => time });
  time = 0;
  store.remember('a');
  store.remember('b');
  store.remember('c');
  time = 60001;
  store.remember('d');
  // All old entries expired, no capacity eviction needed
  const stats = store.stats();
  assert.equal(stats.expirations, 3);
  assert.equal(stats.evictions, 0);
});

test('stats returns correct values', () => {
  const store = new DedupeStore({ clock: () => 10 });
  store.remember('a');
  store.remember('b');
  const stats = store.stats();
  assert.equal(stats.remembered, 2);
  assert.equal(stats.max, 3);
  assert.equal(stats.windowMs, 60000);
  assert.equal(stats.evictions, 0);
  assert.equal(stats.expirations, 0);
});

test('stats counts evictions and expirations separately', () => {
  let time = 0;
  const store = new DedupeStore({ clock: () => time });
  // First, test expirations
  time = 0;
  store.remember('a');
  store.remember('b');
  store.remember('c');
  time = 60001;
  store.remember('d');
  let stats = store.stats();
  assert.equal(stats.expirations, 3);
  assert.equal(stats.evictions, 0);
  
  // Now test evictions (within same time window, no expiry)
  const store2 = new DedupeStore({ clock: () => 100 });
  store2.remember('a');
  store2.remember('b');
  store2.remember('c');
  store2.remember('d');
  store2.remember('e');
  store2.remember('f');
  stats = store2.stats();
  assert.equal(stats.evictions, 3);
  assert.equal(stats.expirations, 0);
});

test('regression: bounded growth prevents memory leak', () => {
  const store = new DedupeStore({ clock: () => 10 });
  // Add many keys to verify bounded memory
  for (let i = 0; i < 10000; i++) {
    store.remember(`key-${i}`);
  }
  assert.equal(store.size(), 3);
  const stats = store.stats();
  assert.equal(stats.evictions, 9997);
});

test('accepts custom clock in constructor', () => {
  let calls = 0;
  const customClock = () => { calls++; return Date.now(); };
  const store = new DedupeStore({ clock: customClock });
  store.remember('test');
  assert.equal(calls, 1);
});

test('default clock is real Date.now', () => {
  const store = new DedupeStore();
  const before = Date.now();
  store.remember('test');
  const after = Date.now();
  const entry = store.has('test');
  assert.equal(entry, true);
});
