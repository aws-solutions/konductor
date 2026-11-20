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

test('includes all days of a 31-day month', () => {
  const report = monthlySummary([], 2025, 1);
  assert.equal(report.days.length, 31);
  assert.equal(report.days[30].date, '2025-01-31');
});

test('includes all days of February in non-leap year', () => {
  const report = monthlySummary([], 2025, 2);
  assert.equal(report.days.length, 28);
  assert.equal(report.days[27].date, '2025-02-28');
});

test('includes all days of February in leap year', () => {
  const report = monthlySummary([], 2024, 2);
  assert.equal(report.days.length, 29);
  assert.equal(report.days[28].date, '2024-02-29');
});

test('booking ending at midnight does not occupy next day', () => {
  const report = monthlySummary([{ id: 'x', room: 'cedar-1', start: '2025-04-14', end: '2025-04-15' }], 2025, 4);
  assert.equal(report.days.find(day => day.date === '2025-04-14').occupied, true);
  assert.equal(report.days.find(day => day.date === '2025-04-15').occupied, false);
});
