'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { runDueSchedules } = require('../src/scheduler');
const { fixedAccounts } = require('./helpers');

test('runs a schedule at its configured time', () => {
  const store = createStore({ accounts: fixedAccounts() });
  const schedules = [{ id: 'morning', enabled: true, clientKey: 'client_morning', fromAccountId: 'acct_a', toAccountId: 'acct_b', amount: '1.00', hour: 9, minute: 30 }];
  const result = runDueSchedules(store, schedules, { minorUnitScale: 100 }, new Date('2025-02-01T09:30:00.000Z'));
  assert.equal(result[0].status, 'done');
  assert.equal(store.getScheduleRun('morning').status, 'done');
});

test('ignores schedules outside their minute', () => {
  const store = createStore({ accounts: fixedAccounts() });
  const schedules = [{ id: 'later', enabled: true, clientKey: 'client_later', fromAccountId: 'acct_a', toAccountId: 'acct_b', amount: '1.00', hour: 10, minute: 0 }];
  assert.deepEqual(runDueSchedules(store, schedules, { minorUnitScale: 100 }, new Date('2025-02-01T09:30:00.000Z')), []);
});
