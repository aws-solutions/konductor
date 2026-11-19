'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkoutConfig } = require('../src/config');

test('merges checkout settings', () => {
  const config = checkoutConfig({ taxRateBps: 900, shipping: { standardShippingCents: 600 } });
  assert.equal(config.taxRateBps, 900);
  assert.equal(config.shipping.standardShippingCents, 600);
  assert.equal(config.shipping.freeShippingThresholdCents, 5000);
});
