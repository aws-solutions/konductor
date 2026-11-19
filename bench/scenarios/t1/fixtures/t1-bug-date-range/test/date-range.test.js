const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, formatDate, daysBetween } = require('../src/date-range');

test('formats a parsed calendar date', () => {
  assert.equal(formatDate('2025-04-14'), '2025-04-14');
});

test('adds ordinary days', () => {
  assert.equal(formatDate(addDays('2025-04-14', 3)), '2025-04-17');
});

test('counts an ordinary two-day span', () => {
  assert.equal(daysBetween('2025-04-14', '2025-04-16'), 2);
});
