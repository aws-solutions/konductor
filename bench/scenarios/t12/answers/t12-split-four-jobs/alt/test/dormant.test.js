'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/dormant.js');

test('jobs/dormant: the 90-day edges from the doc', () => {
  const accounts = [{ id: 'Y', opened: '2026-01-05' }, { id: 'X', opened: '2026-01-05' }, { id: 'NEW', opened: '2026-04-01' }];
  const transactions = [{ accountId: 'X', date: '2026-04-01' }, { accountId: 'Y', date: '2026-04-02' }, { accountId: 'Y', date: '2026-07-01' }];
  assert.deepEqual(run({ asOf: '2026-06-30', accounts, transactions }), ['X']);
});
