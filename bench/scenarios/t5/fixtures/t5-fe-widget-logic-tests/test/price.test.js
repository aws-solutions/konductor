'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPrice, formatRange, currencyDigits } = require('../src/price');

test('formats ordinary dollar prices', () => {
  assert.equal(formatPrice(19.99, 'en-US', 'USD'), '$19.99');
  assert.equal(formatPrice(19.99, 'de-DE', 'EUR'), '19,99 €');
});

test('formats a price range', () => {
  assert.equal(formatRange(10, 25, 'en-US', 'USD'), '$10.00 – $25.00');
  assert.equal(currencyDigits('en-US', 'USD'), 2);
});

test('rejects non-finite prices', () => {
  assert.throws(() => formatPrice(Infinity), /finite/);
  assert.throws(() => formatRange(30, 10), /low price/);
});
