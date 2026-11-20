'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TTLCache } = require('../src/cache/ttl-cache');

function makeClock() {
  let time = 0;
  return { now: () => time, set: (next) => { time = next; } };
}

// The periodic sweep can run at any moment in a live process, so the lookup scenarios below run it part way through.
// A sweep is not lookup traffic: it must not change what readers see or the hit and miss totals.

test('overwriting an entry refreshes its deadline', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 100, now: clock.now, sweepIntervalMs: 0 });
  cache.set('k', 'old');
  clock.set(90);
  cache.set('k', 'new');
  clock.set(120);
  cache.sweep();
  clock.set(150);
  assert.equal(cache.get('k'), 'new');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0 });
  cache.close();
});

test('an overwrite uses the new per-entry TTL', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 1000, now: clock.now, sweepIntervalMs: 0 });
  cache.set('k', 'old', 50);
  clock.set(40);
  cache.set('k', 'new', 200);
  clock.set(60);
  cache.sweep();
  clock.set(100);
  assert.equal(cache.get('k'), 'new');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0 });
  cache.close();
});

test('replacing a value replaces its weight', () => {
  const cache = new TTLCache({ maxSize: 20, sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('k', 'abcdef');
  cache.set('k', 'x');
  assert.equal(cache.weight, 1);
  assert.equal(cache.size, 1);
  cache.close();
});

test('deleting a replaced value removes exactly its current weight', () => {
  const cache = new TTLCache({ maxSize: 20, sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('k', 'abcdef');
  cache.set('k', 'xy');
  cache.delete('k');
  assert.equal(cache.weight, 0);
  assert.equal(cache.size, 0);
  cache.close();
});

test('the size limit is based on current values after replacement', () => {
  const cache = new TTLCache({ maxSize: 5, sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('first', 'abcd');
  cache.set('second', 'e');
  cache.set('first', 'a');
  cache.sweep();
  assert.equal(cache.get('first'), 'a');
  assert.equal(cache.get('second'), 'e');
  assert.equal(cache.weight, 2);
  assert.deepEqual(cache.stats(), { hits: 2, misses: 0 });
  cache.close();
});

test('sweep removes expired entries without changing counters', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 10, now: clock.now, sweepIntervalMs: 0 });
  cache.set('old', 1);
  cache.set('live', 2);
  clock.set(10);
  cache.sweep();
  assert.equal(cache.size, 0);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0 });
  cache.close();
});

test('sweep keeps live entries without recording hits', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 100, now: clock.now, sweepIntervalMs: 0 });
  cache.set('live', 1);
  cache.sweep();
  assert.equal(cache.get('live'), 1);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0 });
  cache.close();
});

test('profile updates keep the refreshed record alive for its full TTL', () => {
  const clock = makeClock();
  const { DataStore } = require('../src/data/store');
  const { ProfileService } = require('../src/services/profile-service');
  const store = new DataStore({ profiles: [{ id: 'p', name: 'before' }] });
  const cache = new TTLCache({ ttlMs: 100, now: clock.now, sweepIntervalMs: 0 });
  const service = new ProfileService({ store, cache });
  service.getProfile('p');
  clock.set(90);
  service.updateProfile('p', { name: 'after' });
  clock.set(120);
  cache.sweep();
  clock.set(150);
  assert.equal(service.getProfile('p').name, 'after');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1 });
  cache.close();
});

test('permission updates keep the refreshed record alive for its full TTL', () => {
  const clock = makeClock();
  const { DataStore } = require('../src/data/store');
  const { PermissionService } = require('../src/services/permission-service');
  const store = new DataStore({ permissions: [{ id: 'p', roles: ['reader'] }] });
  const cache = new TTLCache({ ttlMs: 100, now: clock.now, sweepIntervalMs: 0 });
  const service = new PermissionService({ store, cache });
  service.getPermissions('p');
  clock.set(90);
  service.updatePermissions('p', ['admin']);
  clock.set(120);
  cache.sweep();
  clock.set(150);
  assert.deepEqual(service.getPermissions('p').roles, ['admin']);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1 });
  cache.close();
});

test('sweeping does not inflate hit counts for ordinary traffic', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 100, now: clock.now, sweepIntervalMs: 0 });
  cache.set('one', 1);
  cache.set('two', 2);
  assert.equal(cache.get('one'), 1);
  cache.sweep();
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0 });
  cache.close();
});

test('an overwrite keeps one entry while reporting its actual weight', () => {
  const cache = new TTLCache({ sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('k', 'long-value');
  cache.set('k', 'ok');
  assert.equal(cache.size, 1);
  assert.equal(cache.weight, 2);
  cache.close();
});

test('expired reads at the deadline count as a miss', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 5, now: clock.now, sweepIntervalMs: 0 });
  cache.set('k', 1);
  clock.set(3);
  cache.sweep();
  clock.set(5);
  assert.equal(cache.get('k'), undefined);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 1 });
  cache.close();
});

test('has checks expiry without changing hit or miss counters', () => {
  const clock = makeClock();
  const cache = new TTLCache({ ttlMs: 5, now: clock.now, sweepIntervalMs: 0 });
  cache.set('k', 1);
  cache.sweep();
  assert.equal(cache.has('k'), true);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0 });
  cache.close();
});

test('close can be called on a cache without a sweep timer', () => {
  const cache = new TTLCache({ sweepIntervalMs: 0 });
  assert.doesNotThrow(() => cache.close());
});

test('zero-weight replacement releases the previous weight', () => {
  const cache = new TTLCache({ maxSize: 1, sizeCalculation: (value) => value.length, sweepIntervalMs: 0 });
  cache.set('free', 'x');
  cache.set('free', '');
  cache.sweep();
  assert.equal(cache.get('free'), '');
  assert.equal(cache.weight, 0);
  assert.deepEqual(cache.stats(), { hits: 1, misses: 0 });
  cache.close();
});
