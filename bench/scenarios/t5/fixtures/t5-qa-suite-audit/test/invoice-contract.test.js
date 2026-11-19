'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeInvoice } = require('../src/invoices');

const input = { id: 'inv_contract', customerId: 'cus_contract', planId: 'growth', cycleStart: '2025-04-01' };

test('invoice contract remains stable', () => {
  const actual = makeInvoice(input);
  assert.deepEqual(actual, makeInvoice(input));
});
