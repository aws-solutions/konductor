const test = require('node:test');
const assert = require('node:assert/strict');
const euQueue = require('../jobs/eu-queue');
const usQueue = require('../jobs/us-queue');

test('queue jobs keep the region in the setting key', () => {
  assert.deepEqual(euQueue(), { url: 'https://queue-eu.fleet.test', health: 'https://queue-eu.fleet.test/health' });
  assert.deepEqual(usQueue(), { url: 'https://queue-us.fleet.test', health: 'https://queue-us.fleet.test/health' });
});
