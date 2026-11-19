'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BillingService } = require('../src/billing-service');
const { InMemoryRepository } = require('../src/repository');

function service(result = { status: 'succeeded' }) {
  return new BillingService({ repository: new InMemoryRepository(), paymentGateway: { charge: () => result }, idFactory: () => 'inv_fixed' });
}

test('service persists invoices with a stable id', () => {
  const app = service();
  const invoice = app.createInvoice({ customerId: 'cus_1', planId: 'starter', cycleStart: '2025-01-01' });
  assert.equal(invoice.id, 'inv_fixed');
  assert.equal(app.repository.getInvoice('inv_fixed').customerId, 'cus_1');
});

test('successful collection marks invoice paid and posts cash', () => {
  const app = service();
  app.createInvoice({ id: 'inv_paid', customerId: 'cus_1', planId: 'starter', cycleStart: '2025-01-01' });
  const paid = app.collect('inv_paid', { token: 'tok' });
  assert.equal(paid.status, 'paid');
  assert.equal(app.repository.listEntries()[0].account, 'cash');
});

test('failed collection retains retry state', () => {
  const app = service({ status: 'failed', retryable: true, code: 'temporary' });
  app.createInvoice({ id: 'inv_retry', customerId: 'cus_1', planId: 'starter', cycleStart: '2025-01-01' });
  assert.equal(app.collect('inv_retry', {}).status, 'retrying');
  assert.equal(app.repository.getInvoice('inv_retry').attempts, 1);
});
