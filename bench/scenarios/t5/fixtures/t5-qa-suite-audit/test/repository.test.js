'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryRepository } = require('../src/repository');

test('repository returns copies of stored invoices', () => {
  const repo = new InMemoryRepository();
  const invoice = { id: 'i', totalCents: 12, lines: [{ amountCents: 12 }] };
  repo.saveInvoice(invoice);
  const copy = repo.getInvoice('i');
  copy.lines[0].amountCents = 99;
  assert.equal(repo.getInvoice('i').lines[0].amountCents, 12);
  assert.equal(repo.getInvoice('missing'), null);
});

test('event ids and ledger entries are retained', () => {
  const repo = new InMemoryRepository();
  repo.saveEvent('evt');
  repo.addEntry({ reference: 'r', amountCents: 1 });
  assert.equal(repo.hasEvent('evt'), true);
  assert.deepEqual(repo.listEntries(), [{ reference: 'r', amountCents: 1 }]);
});
