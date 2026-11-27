'use strict';

// Hidden test of t12-split-four-jobs: docs/jobs/dormant.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/dormant.js');

test('dormant: the spec example (the window edge)', () => {
  const accounts = [{ id: 'X', opened: '2026-01-05' }, { id: 'Y', opened: '2026-01-05' }];
  const transactions = [{ accountId: 'X', date: '2026-04-01' }, { accountId: 'Y', date: '2026-04-02' }];
  assert.deepEqual(run({ asOf: '2026-06-30', accounts, transactions }), ['X']);
});

test('dormant: an account opened 90 days before asOf or later is never dormant', () => {
  const accounts = [{ id: 'A', opened: '2026-04-01' }, { id: 'B', opened: '2026-03-31' }, { id: 'C', opened: '2026-06-30' }];
  assert.deepEqual(run({ asOf: '2026-06-30', accounts, transactions: [] }), ['B']);
});

test('dormant: future transactions and unknown ids are ignored; ids sorted, no repeats', () => {
  const accounts = [{ id: 'm2', opened: '2025-01-01' }, { id: 'M1', opened: '2025-01-01' }, { id: 'm2', opened: '2025-01-01' }];
  const transactions = [{ accountId: 'm2', date: '2026-07-01' }, { accountId: 'ghost', date: '2026-06-01' }];
  assert.deepEqual(run({ asOf: '2026-06-30', accounts, transactions }), ['M1', 'm2']);
});

test('dormant: day counts do not move across a clock change', () => {
  const accounts = [{ id: 'D', opened: '2025-01-01' }];
  // 2026-11-04 is 90 days before 2027-02-02 across the November clock change
  assert.deepEqual(run({ asOf: '2027-02-02', accounts, transactions: [{ accountId: 'D', date: '2026-11-04' }] }), ['D']);
  assert.deepEqual(run({ asOf: '2027-02-02', accounts, transactions: [{ accountId: 'D', date: '2026-11-05' }] }), []);
});
