'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TaxAdapter } = require('../src/adapters/tax');

test('tax adapter sends customer address and amount', () => {
  const calls = [];
  const adapter = new TaxAdapter({ getQuote(input) { calls.push(input); return { taxCents: 88, jurisdiction: 'CA' }; } });
  assert.deepEqual(adapter.quote({ customer: { country: 'US', postalCode: '94105' }, amountCents: 2000 }), { amountCents: 88, jurisdiction: 'CA' });
  assert.deepEqual(calls[0], { country: 'US', postalCode: '94105', amountCents: 2000, currency: 'USD' });
});
