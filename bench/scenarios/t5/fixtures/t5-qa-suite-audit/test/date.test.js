'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, addMonths, daysBetween } = require('../src/date');

test('date parser rejects malformed and impossible dates', () => {
  assert.equal(parseDate('2025-02-10').toISOString(), '2025-02-10T00:00:00.000Z');
  assert.throws(() => parseDate('2025-2-10'), /YYYY/);
  assert.throws(() => parseDate('2025-02-30'), /invalid/);
});

test('month arithmetic clamps the end of a short month', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2025-03-31', -1), '2025-02-28');
});

test('calendar difference ignores time zones', () => assert.equal(daysBetween('2025-01-01', '2025-02-01'), 31));
