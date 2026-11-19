const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween, monthRange, overlaps, formatDate } = require('../src/date-range');

test('month range has a following-month end', () => {
  assert.equal(formatDate(monthRange(2025, 1).end), '2025-02-01');
});

test('touching ranges do not overlap', () => {
  assert.equal(overlaps('2025-01-01T09:00:00', '2025-01-01T10:00:00', '2025-01-01T10:00:00', '2025-01-01T11:00:00'), false);
});

test('calendar days ignore a clock change', () => {
  assert.equal(daysBetween('2025-03-08', '2025-03-10'), 2);
});
