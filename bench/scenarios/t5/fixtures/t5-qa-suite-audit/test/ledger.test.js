'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { postEntry, accountBalance, reconcile } = require('../src/ledger');
const { InMemoryRepository } = require('../src/repository');

test('ledger posts entries and calculates account balance', () => {
  const repo = new InMemoryRepository();
  postEntry(repo, { reference: 'inv_1', account: 'cash', amountCents: 1000, direction: 'credit' });
  postEntry(repo, { reference: 'inv_1', account: 'receivable', amountCents: 1000, direction: 'debit' });
  assert.equal(accountBalance(repo.listEntries(), 'cash'), 1000);
  assert.equal(accountBalance(repo.listEntries(), 'receivable'), -1000);
});

test('reconciliation exposes balanced references', () => {
  const entries = [
    { reference: 'a', account: 'cash', amountCents: 10, direction: 'credit' },
    { reference: 'a', account: 'receivable', amountCents: 10, direction: 'debit' },
    { reference: 'b', account: 'cash', amountCents: 4, direction: 'credit' }
  ];
  assert.deepEqual(reconcile(entries), [{ reference: 'a', balanced: true, balance: 0 }, { reference: 'b', balanced: false, balance: 4 }]);
});
