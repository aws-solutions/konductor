'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TTLCache } = require('../src/cache/ttl-cache');
const { DataStore } = require('../src/data/store');
const { ProfileService } = require('../src/services/profile-service');

test('profile service loads and then caches a profile', () => {
  const service = new ProfileService({
    store: new DataStore({ profiles: [{ id: 'a', name: 'A' }] }),
    cache: new TTLCache({ sweepIntervalMs: 0 })
  });
  assert.equal(service.getProfile('a').name, 'A');
  assert.equal(service.getProfile('a').name, 'A');
});

test('profile service returns null for an unknown profile', () => {
  const cache = new TTLCache({ sweepIntervalMs: 0 });
  const service = new ProfileService({ store: new DataStore(), cache });
  assert.equal(service.getProfile('missing'), null);
  cache.close();
});
