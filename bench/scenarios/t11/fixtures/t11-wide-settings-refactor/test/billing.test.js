const test = require('node:test');
const assert = require('node:assert/strict');
const tax = require('../apps/billing/tax');
const retries = require('../apps/billing/retries');

test('billing modules calculate invoice values', () => {
  assert.deepEqual(tax(), { rate: 0.2, percent: 20 });
  assert.deepEqual(retries(), { retries: 0, attempts: 1 });
});
