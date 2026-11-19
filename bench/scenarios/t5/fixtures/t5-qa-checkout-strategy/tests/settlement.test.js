const test = require('node:test');
const assert = require('node:assert/strict');
const { cutoffFor, eligibleTransactions } = require('../src/jobs/settlement');

test('settlement includes succeeded transactions before the cutoff', () => {
  const now = new Date('2025-05-02T20:00:00.000Z');
  const rows = [
    { id: 'a', status: 'succeeded', createdAt: '2025-05-02T18:00:00.000Z' },
    { id: 'b', status: 'failed', createdAt: '2025-05-02T18:00:00.000Z' }
  ];
  assert.deepEqual(eligibleTransactions(rows, now).map((row) => row.id), ['a']);
  assert.equal(cutoffFor(now).getMinutes(), 59);
});
