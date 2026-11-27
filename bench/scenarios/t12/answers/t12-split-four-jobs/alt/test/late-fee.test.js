'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/late-fee.js');

test('jobs/late-fee: fee bands and the account cap', () => {
  const bills = [
    { accountId: 'B', due: '2026-03-01', paid: '2026-03-31' },
    { accountId: 'A', due: '2026-01-01', paid: null },
    { accountId: 'A', due: '2026-02-01', paid: null },
    { accountId: 'C', due: '2026-06-01', paid: '2026-06-01' },
    { accountId: 'D', due: '2026-07-15', paid: null },
  ];
  assert.deepEqual(run({ asOf: '2026-06-30', bills }), {
    fees: [{ accountId: 'A', feeCents: 7500 }, { accountId: 'B', feeCents: 2500 }],
    totalCents: 10000,
  });
});
