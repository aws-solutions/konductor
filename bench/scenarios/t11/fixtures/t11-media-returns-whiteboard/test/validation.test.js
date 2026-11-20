'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validLine } = require('../src/validation');
test('validates a nonnegative integer line amount', () => {
  assert.equal(validLine({ id: 'x', amountCents: 1 }), true);
  assert.equal(validLine({ id: 'x', amountCents: -1 }), false);
  assert.equal(validLine({ id: 'x', amountCents: 1.5 }), false);
});
