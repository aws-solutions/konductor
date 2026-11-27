'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const interest = require('../src/jobs/interest.js');
const statement = require('../src/jobs/statement.js');
const dormant = require('../src/jobs/dormant.js');
const lateFee = require('../src/jobs/late-fee.js');

test('interest follows docs/jobs/interest.md', () => {
  assert.deepEqual(interest.run([{ id: 'A2', status: 'active', balanceCents: 120000, apr: '19.99' }]), [{ id: 'A2', interestCents: 1999 }]);
  assert.throws(() => interest.run([{ id: 'B', status: 'active', balanceCents: 1, apr: '1.234' }]), /B/);
});

test('statement follows docs/jobs/statement.md', () => {
  assert.equal(statement.run([{ date: '2026-03-02', description: 'Coffee beans', amountCents: -1250 }])[0], '2026-03-02 COFFEE BEANS             12.50-');
});

test('dormant follows docs/jobs/dormant.md', () => {
  const accounts = [{ id: 'X', opened: '2026-01-05' }, { id: 'Y', opened: '2026-01-05' }];
  assert.deepEqual(dormant.run({ asOf: '2026-06-30', accounts, transactions: [{ accountId: 'X', date: '2026-04-01' }, { accountId: 'Y', date: '2026-04-02' }] }), ['X']);
});

test('late-fee follows docs/jobs/late-fee.md', () => {
  assert.deepEqual(lateFee.run({ asOf: '2026-06-30', bills: [{ accountId: 'B', due: '2026-03-01', paid: '2026-03-31' }] }), { fees: [{ accountId: 'B', feeCents: 2500 }], totalCents: 2500 });
});
