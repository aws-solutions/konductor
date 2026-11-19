'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

test('profile handler returns a profile response', () => {
  const app = createApp({ profiles: [{ id: 'a', name: 'A' }], cacheOptions: { sweepIntervalMs: 0 } });
  assert.deepEqual(app.profile({ id: 'a' }), { status: 200, body: { id: 'a', name: 'A' } });
  app.close();
});

test('handlers validate an absent id', () => {
  const app = createApp({ cacheOptions: { sweepIntervalMs: 0 } });
  assert.equal(app.permissions({}).status, 400);
  app.close();
});
