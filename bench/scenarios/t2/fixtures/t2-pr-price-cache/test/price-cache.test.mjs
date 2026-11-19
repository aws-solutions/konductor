import test from 'node:test';
import assert from 'node:assert/strict';
import { PriceCache } from '../src/cache/price-cache.mjs';

test('cache returns a value before its deadline', () => {
  let now = 1000;
  const cache = new PriceCache({ now: () => now, ttlMs: 100 });
  const prices = [{ productId: 'pencil', amount: 1.25 }];
  cache.set('retail', prices);
  assert.deepEqual(cache.get('retail'), prices);
  now = 1099;
  assert.deepEqual(cache.get('retail'), prices);
});

test('cache removes an expired value on read', () => {
  let now = 1000;
  const cache = new PriceCache({ now: () => now, ttlMs: 100 });
  cache.set('retail', [{ productId: 'pencil' }]);
  now = 1100;
  assert.equal(cache.get('retail'), undefined);
  assert.equal(cache.size, 0);
});

test('cache can remove one list after a write', () => {
  const cache = new PriceCache();
  cache.set('retail', [{ amount: 1 }]);
  cache.set('contract', [{ amount: 2 }]);
  assert.equal(cache.delete('retail'), true);
  assert.equal(cache.get('retail'), undefined);
  assert.deepEqual(cache.get('contract'), [{ amount: 2 }]);
});

test('cache reports the configured entry ceiling', () => {
  const cache = new PriceCache({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.limit, 2);
  assert.equal(cache.size, 2);
});

test('cache clear removes all lists', () => {
  const cache = new PriceCache();
  cache.set('retail', []);
  cache.clear();
  assert.equal(cache.size, 0);
});

test('cache overwrites a list when refreshed', () => {
  const cache = new PriceCache();
  cache.set('retail', [{ amount: 1 }]);
  cache.set('retail', [{ amount: 2 }]);
  assert.deepEqual(cache.get('retail'), [{ amount: 2 }]);
});

test('cache accepts a per-entry lifetime', () => {
  let now = 500;
  const cache = new PriceCache({ now: () => now, ttlMs: 1000 });
  cache.set('retail', ['fresh'], 20);
  now = 519;
  assert.deepEqual(cache.get('retail'), ['fresh']);
  now = 520;
  assert.equal(cache.get('retail'), undefined);
});

test('cache treats an absent key as a miss', () => {
  const cache = new PriceCache();
  assert.equal(cache.get('unknown'), undefined);
});

test('cache accepts a falsy stored value', () => {
  const cache = new PriceCache();
  cache.set('empty', 0);
  assert.equal(cache.get('empty'), 0);
});
