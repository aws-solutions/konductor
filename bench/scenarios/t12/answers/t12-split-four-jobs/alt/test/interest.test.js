'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/interest.js');

test('jobs/interest: the doc example, skips and rounding', () => {
  assert.deepEqual(run([{ id: 'A2', status: 'active', balanceCents: 120000, apr: '19.99' }]), [{ id: 'A2', interestCents: 1999 }]);
  assert.deepEqual(run([
    { id: 'Z', status: 'frozen', balanceCents: 600, apr: '25' },
    { id: 'C', status: 'closed', balanceCents: 999999, apr: '30' },
    { id: 'N', status: 'active', balanceCents: -500, apr: '10' },
  ]), [{ id: 'Z', interestCents: 13 }]);
});

test('jobs/interest: a bad apr names the account', () => {
  for (const apr of ['abc', '1.234', '']) assert.throws(() => run([{ id: 'Q9', status: 'active', balanceCents: 100, apr }]), /Q9/);
});
