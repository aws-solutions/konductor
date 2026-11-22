'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { transfer } = require('../src/transfers');

function store() {
  return createStore({ accounts: [
    { id: 'acct_a', balanceMinor: 1000, createdAt: '2025-01-01T00:00:00.000Z' },
    { id: 'acct_b', balanceMinor: 0, createdAt: '2025-01-01T00:00:00.000Z' },
  ] });
}

test('moves a balance and records the client key', () => {
  const s = store();
  const result = transfer(s, { clientKey: 'client_1', fromAccountId: 'acct_a', toAccountId: 'acct_b', amountMinor: 250 });
  assert.equal(result.id, 'tr_client_1');
  assert.equal(s.getAccount('acct_a').balanceMinor, 750);
  assert.equal(s.listJournal().length, 2);
});

test('reuses a completed client key', () => {
  const s = store();
  const first = transfer(s, { clientKey: 'client_2', fromAccountId: 'acct_a', toAccountId: 'acct_b', amountMinor: 100 });
  const second = transfer(s, { clientKey: 'client_2', fromAccountId: 'acct_a', toAccountId: 'acct_b', amountMinor: 100 });
  assert.deepEqual(second, first);
  assert.equal(s.listJournal().length, 2);
});
