'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DataStore } = require('../src/data/store');

test('store copies records on read', () => {
  const store = new DataStore({ profiles: [{ id: 'a', name: 'A' }], permissions: [{ id: 'a', roles: ['reader'] }] });
  const record = store.getProfile('a');
  record.name = 'changed';
  assert.equal(store.getProfile('a').name, 'A');
});

test('store updates existing profiles', () => {
  const store = new DataStore({ profiles: [{ id: 'a', name: 'A' }] });
  assert.deepEqual(store.updateProfile('a', { team: 'ops' }), { id: 'a', name: 'A', team: 'ops' });
  assert.equal(store.updateProfile('missing', { name: 'x' }), null);
});
