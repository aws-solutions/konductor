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

test('evicts oldest when at capacity', () => {
  const store = new DedupeStore({ clock: () => 10 });
  store.remember('a');
  store.remember('b');
  store.remember('c');
  assert.equal(store.size(), 3);
  store.remember('d');
  assert.equal(store.size(), 3);
  assert.equal(store.has('a'), false);
  assert.equal(store.has('d'), true);
});
