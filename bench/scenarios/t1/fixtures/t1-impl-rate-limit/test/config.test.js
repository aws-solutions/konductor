const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, merge } = require('../src/config');

test('default config includes the service identity', () => {
  const config = loadConfig('default');
  assert.equal(config.serviceName, 'booking-api');
  assert.equal(typeof config.port, 'number');
});

test('config merge replaces scalar values and keeps siblings', () => {
  const result = merge({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 9 } });
  assert.deepEqual(result, { a: { b: 9, c: 2 }, d: 3 });
});
