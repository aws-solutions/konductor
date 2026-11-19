'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeInvoice, previewPlanChange } = require('../src/invoices');

test('invoice includes the plan and extra lines', () => {
  const invoice = makeInvoice({ id: 'inv_1', customerId: 'cus_1', planId: 'starter', cycleStart: '2025-01-01', lines: [{ description: 'seat', amountCents: 500 }] });
  assert.equal(invoice.totalCents, 1700);
  assert.equal(invoice.lines.length, 2);
  assert.equal(invoice.dueDate, '2025-02-01');
});

test('invoice rejects missing identity', () => assert.throws(() => makeInvoice({ planId: 'starter', cycleStart: '2025-01-01' }), /identity/));

test('plan preview identifies the changed plans', () => {
  const preview = previewPlanChange({ invoiceId: 'inv_2', oldPlanId: 'starter', newPlanId: 'growth', cycleStart: '2025-01-01', changeDate: '2025-01-16' });
  assert.equal(preview.invoiceId, 'inv_2');
  assert.equal(preview.oldPlan, 'starter');
  assert.equal(preview.newPlan, 'growth');
  assert.ok(preview.amountCents > 0);
});
