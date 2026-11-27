'use strict';

// Hidden test of t12-split-four-jobs: docs/jobs/late-fee.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/late-fee.js');

const bill = (accountId, due, paid) => ({ accountId, due, paid });

test('late-fee: on time, 1 to 30 days late and more than 30 days late', () => {
  const out = run({ asOf: '2026-06-30', bills: [bill('A', '2026-03-01', '2026-03-01'), bill('B', '2026-03-01', '2026-03-31'), bill('C', '2026-03-01', '2026-04-01')] });
  assert.deepEqual(out, { fees: [{ accountId: 'B', feeCents: 2500 }, { accountId: 'C', feeCents: 5000 }], totalCents: 7500 });
});

test('late-fee: unpaid bills count to asOf; a bill due after asOf is not charged', () => {
  const out = run({ asOf: '2026-06-30', bills: [bill('U', '2026-06-29', null), bill('V', '2026-05-30', null), bill('W', '2026-05-31', null), bill('F', '2026-07-01', null)] });
  assert.deepEqual(out.fees, [{ accountId: 'U', feeCents: 2500 }, { accountId: 'V', feeCents: 5000 }, { accountId: 'W', feeCents: 2500 }]);
});

test('late-fee: fees per account are capped at 7500 and sorted by account', () => {
  const bills = [bill('Z', '2026-01-01', null), bill('Z', '2026-02-01', null), bill('a', '2026-06-01', '2026-06-02'), bill('Z', '2026-03-01', null)];
  assert.deepEqual(run({ asOf: '2026-06-30', bills }), { fees: [{ accountId: 'Z', feeCents: 7500 }, { accountId: 'a', feeCents: 2500 }], totalCents: 10000 });
});

test('late-fee: day counts do not move across a clock change; no bills is an empty result', () => {
  assert.deepEqual(run({ asOf: '2026-12-01', bills: [bill('T', '2026-10-31', '2026-11-30')] }).fees, [{ accountId: 'T', feeCents: 2500 }]);
  assert.deepEqual(run({ asOf: '2026-12-01', bills: [] }), { fees: [], totalCents: 0 });
});
