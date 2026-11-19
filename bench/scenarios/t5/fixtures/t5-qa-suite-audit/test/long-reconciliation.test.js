'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcile, accountBalance } = require('../src/ledger');

test('large export keeps every reference balanced', () => {
  const entries = [];
  for (let i = 0; i < 240; i += 1) {
    const reference = `batch_${String(i).padStart(3, '0')}`;
    const amount = (i + 1) * 17;
    entries.push({ reference, account: 'cash', amountCents: amount, direction: 'credit' });
    entries.push({ reference, account: 'receivable', amountCents: amount, direction: 'debit' });
    if (i % 7 === 0) entries.push({ reference, account: 'fee', amountCents: 3, direction: 'credit' }, { reference, account: 'receivable', amountCents: 3, direction: 'debit' });
  }
  const report = reconcile(entries);
  assert.equal(report.length, 240);
  assert.ok(report.every((row) => row.balanced && row.balance === 0));
  assert.equal(accountBalance(entries, 'cash'), entries.filter((entry) => entry.account === 'cash').reduce((sum, entry) => sum + entry.amountCents, 0));
});
