const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlySummary } = require('../src/report');

test('returns a report with a month label', () => {
  const report = monthlySummary([], 2025, 4);
  assert.equal(report.month, '2025-04');
  assert.equal(report.days[0].date, '2025-04-01');
});

test('marks a normal booking day occupied', () => {
  const report = monthlySummary([{ id: 'x', room: 'cedar-1', start: '2025-04-14T09:00:00', end: '2025-04-14T10:00:00' }], 2025, 4);
  assert.equal(report.days.find(day => day.date === '2025-04-14').occupied, true);
});
