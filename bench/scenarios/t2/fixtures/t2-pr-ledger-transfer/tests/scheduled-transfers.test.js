'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { runScheduledTransfer, amountToMinor } = require('../src/scheduled-transfers');
const { fixedAccounts } = require('./helpers');

const ledger = { minorUnitScale: 100 };
const schedule = { id: 'rent', enabled: true, clientKey: 'client_schedule_1', fromAccountId: 'acct_a', toAccountId: 'acct_b', amount: '2.50' };

test('converts a configured amount for the ledger', () => {
  assert.equal(amountToMinor('12.50', 100), 1250);
});

test('runs an enabled scheduled transfer', () => {
  const store = createStore({ accounts: fixedAccounts() });
  const result = runScheduledTransfer(store, schedule, ledger, '2025-02-01T09:00:00.000Z');
  assert.equal(result.status, 'done');
  assert.equal(store.listJournal().length, 2);
  assert.equal(store.getAccount('acct_a').balanceMinor, 750);
});

test('skips a disabled schedule', () => {
  const store = createStore({ accounts: fixedAccounts() });
  const result = runScheduledTransfer(store, { ...schedule, enabled: false }, ledger);
  assert.deepEqual(result, { status: 'skipped', reason: 'disabled' });
  assert.equal(store.listJournal().length, 0);
});
