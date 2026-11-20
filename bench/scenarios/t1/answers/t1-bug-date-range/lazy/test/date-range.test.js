const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaps } = require('../src/date-range');

test('formats a parsed calendar date', () => {
  assert.equal(require('../src/date-range').formatDate('2025-04-14'), '2025-04-14');
});

test('adds ordinary days', () => {
  assert.equal(require('../src/date-range').formatDate(require('../src/date-range').addDays('2025-04-14', 3)), '2025-04-17');
});

test('counts an ordinary two-day span', () => {
  assert.equal(require('../src/date-range').daysBetween('2025-04-14', '2025-04-16'), 2);
});

test('treats end instant as free for overlap', () => {
  assert.equal(overlaps('2025-04-14', '2025-04-15', '2025-04-15', '2025-04-16'), false);
});
