'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/statement.js');

test('jobs/statement: lines, order and total', () => {
  const lines = run([
    { date: '2026-03-05', description: 'Rent for the month of March', amountCents: 123456 },
    { date: '2026-03-02', description: 'Coffee beans', amountCents: -1250 },
  ]);
  assert.deepEqual(lines, [
    '2026-03-02 COFFEE BEANS             12.50-',
    '2026-03-05 RENT FOR THE MONTH O  1,234.56 ',
    'TOTAL                            1,222.06 ',
  ]);
  for (const l of lines) assert.equal(l.length, 42);
});

test('jobs/statement: an amount too wide throws', () => {
  assert.throws(() => run([{ date: '2026-01-01', description: 'x', amountCents: 10000000000 }]), RangeError);
});
