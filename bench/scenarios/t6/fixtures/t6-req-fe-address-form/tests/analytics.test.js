const test = require('node:test');
const assert = require('node:assert/strict');
const { eventNames } = require('../src/analytics');

test('exposes the checkout address events', () => {
  assert.deepEqual(eventNames(), ['checkout_address_viewed', 'checkout_address_submitted', 'checkout_address_lookup_used']);
});
