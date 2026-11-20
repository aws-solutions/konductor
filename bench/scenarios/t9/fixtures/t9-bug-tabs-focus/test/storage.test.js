const test = require('node:test');
const assert = require('node:assert/strict');
const { readSetting, storageKey } = require('../src/storage.js');

function memoryStore() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('settings use a namespaced storage key', () => {
  const store = memoryStore();
  store.setItem('northstar:theme', 'dusk');
  assert.equal(storageKey('theme'), 'northstar:theme');
  assert.equal(readSetting(store, 'theme', 'mist'), 'dusk');
  assert.equal(readSetting(store, 'missing', 'mist'), 'mist');
});
