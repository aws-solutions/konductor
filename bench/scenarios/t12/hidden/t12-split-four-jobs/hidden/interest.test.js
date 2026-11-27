'use strict';

// Hidden test of t12-split-four-jobs: docs/jobs/interest.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/interest.js');

const acct = (id, balanceCents, apr, status = 'active') => ({ id, status, balanceCents, apr });

test('interest: the spec example and plain string order of ids', () => {
  assert.deepEqual(run([acct('A2', 120000, '19.99')]), [{ id: 'A2', interestCents: 1999 }]);
  assert.deepEqual(run([acct('B1', 1200, '12'), acct('A10', 1200, '12'), acct('A9', 1200, '12')]).map((r) => r.id), ['A10', 'A9', 'B1']);
});

test('interest: closed and non-positive balances give no row; frozen accounts are charged', () => {
  const out = run([acct('C', 50000, '10', 'closed'), acct('Z', 0, '10'), acct('N', -5000, '10'), acct('F', 120000, '10', 'frozen')]);
  assert.deepEqual(out, [{ id: 'F', interestCents: 1000 }]);
});

test('interest: rounds half up to a whole cent, with no floating-point drift', () => {
  assert.deepEqual(run([acct('H', 150, '10')]), [{ id: 'H', interestCents: 1 }]); // 1.25 -> 1
  assert.deepEqual(run([acct('H', 600, '25')]), [{ id: 'H', interestCents: 13 }]); // 12.5 -> 13
  assert.deepEqual(run([acct('P', 100000000, '17.49')]), [{ id: 'P', interestCents: 1457500 }]);
  assert.deepEqual(run([acct('Q', 33333, '29.9')]), [{ id: 'Q', interestCents: 831 }]); // 830.547...
  assert.deepEqual(run([acct('R', 1, '6')]), [{ id: 'R', interestCents: 0 }]); // 0.005 -> 0
  assert.deepEqual(run([acct('S', 50, '12')]), [{ id: 'S', interestCents: 1 }]); // 0.5 -> 1
});

test('interest: a bad apr throws an Error naming the account', () => {
  for (const apr of ['abc', '1.234', '', '-5']) assert.throws(() => run([acct('BAD-7', 1000, apr)]), /BAD-7/, apr);
});
