'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quote } = require('../src');

test('monthly prices for customers outside the EU', () => {
  assert.deepEqual(quote({ plan: 'starter' }), { totalCents: 900, taxCents: 0 });
  assert.deepEqual(quote({ plan: 'team', customer: { region: 'US' } }), { totalCents: 2900, taxCents: 0 });
  assert.deepEqual(quote({ plan: 'enterprise', billing: 'monthly' }), { totalCents: 9900, taxCents: 0 });
});

test('unknown plan or billing period throws RangeError', () => {
  assert.throws(() => quote({ plan: 'gold' }), RangeError);
  assert.throws(() => quote({ plan: 'team', billing: 'weekly' }), RangeError);
});
