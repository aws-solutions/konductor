'use strict';

// Hidden test of t12-split-four-jobs: docs/jobs/statement.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/jobs/statement.js');

test('statement: the spec example line, 42 characters', () => {
  const [line] = run([{ date: '2026-03-02', description: 'Coffee beans', amountCents: -1250 }]);
  assert.equal(line, '2026-03-02 COFFEE BEANS             12.50-');
  assert.equal(line.length, 42);
});

test('statement: descriptions cut or padded to 20, commas every three digits, positive amounts end in a space', () => {
  const [line] = run([{ date: '2026-03-03', description: 'Annual membership fee for 2026', amountCents: 1234567 }]);
  assert.equal(line, '2026-03-03 ANNUAL MEMBERSHIP FE 12,345.67 ');
  assert.throws(() => run([{ date: '2026-03-03', description: 'x', amountCents: 12345678901 }]), RangeError);
  const [small] = run([{ date: '2026-03-04', description: 'Gum', amountCents: 5 }]);
  assert.equal(small, `2026-03-04 ${'GUM'.padEnd(20)} ${'0.05 '.padStart(10)}`);
});

test('statement: date order, input order on equal dates, then the total line', () => {
  const out = run([
    { date: '2026-03-05', description: 'b', amountCents: 200 },
    { date: '2026-03-01', description: 'a', amountCents: 100 },
    { date: '2026-03-05', description: 'c', amountCents: -1000 },
  ]);
  assert.deepEqual(out.map((l) => l.slice(11, 12)), ['A', 'B', 'C', ' ']);
  assert.equal(out[3], `${'TOTAL'.padEnd(31)} ${'7.00-'.padStart(10)}`);
  assert.equal(out[3].length, 42);
});

test('statement: no transactions is a zero total line only', () => {
  assert.deepEqual(run([]), [`${'TOTAL'.padEnd(31)} ${'0.00 '.padStart(10)}`]);
});
