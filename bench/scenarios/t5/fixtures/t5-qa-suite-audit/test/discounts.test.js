'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeInvoice } = require('../src/invoices');

test('invoice lines do not contain negative charges', () => {
  const invoice = makeInvoice({ id: 'inv_discount', customerId: 'cus', planId: 'starter', cycleStart: '2025-06-01' });
  const adjustments = invoice.lines.filter((line) => line.amountCents < 0);
  for (const adjustment of adjustments) {
    assert.fail(`unexpected adjustment ${adjustment.description}`);
  }
  assert.ok(true);
});
