'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { reconcile } = require('../src/reconcile');

test('reports a balanced account', () => {
  const s = createStore({ accounts: [{ id: 'acct_a', balanceMinor: 10, createdAt: '2025-01-01T00:00:00.000Z' }], journal: [{ accountId: 'acct_a', amountMinor: 10 }] });
  assert.equal(reconcile(s)[0].balanced, true);
});
