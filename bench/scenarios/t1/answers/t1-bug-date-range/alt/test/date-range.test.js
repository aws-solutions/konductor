const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, formatDate, daysBetween, overlaps, monthRange } = require('../src/date-range');

test('formats a parsed calendar date', () => {
  assert.equal(formatDate('2025-04-14'), '2025-04-14');
});

test('adds ordinary days', () => {
  assert.equal(formatDate(addDays('2025-04-14', 3)), '2025-04-17');
});

test('counts an ordinary two-day span', () => {
  assert.equal(daysBetween('2025-04-14', '2025-04-16'), 2);
});

test('counts nights correctly across DST spring forward', () => {
  // March 2025 DST transition in US: March 9 at 2am clocks spring forward to 3am
  // A stay from March 8 to March 10 should be 2 nights
  assert.equal(daysBetween('2025-03-08', '2025-03-10'), 2);
});

test('counts nights correctly across DST fall back', () => {
  // November 2025 DST transition in US: November 2 at 2am clocks fall back to 1am
  // A stay from November 1 to November 3 should be 2 nights
  assert.equal(daysBetween('2025-11-01', '2025-11-03'), 2);
});

test('treats end instant as free - adjacent bookings do not overlap', () => {
  // Booking ending at midnight should not block next day
  assert.equal(overlaps('2025-04-14', '2025-04-15', '2025-04-15', '2025-04-16'), false);
});

test('treats end instant as free - booking at same time overlaps', () => {
  assert.equal(overlaps('2025-04-14T09:00:00', '2025-04-14T10:00:00', '2025-04-14T09:30:00', '2025-04-14T11:00:00'), true);
});

test('monthRange returns first day after month for end', () => {
  const range = monthRange(2025, 4);
  assert.equal(formatDate(range.start), '2025-04-01');
  assert.equal(formatDate(range.end), '2025-05-01');
});

test('monthRange handles December correctly', () => {
  const range = monthRange(2025, 12);
  assert.equal(formatDate(range.start), '2025-12-01');
  assert.equal(formatDate(range.end), '2026-01-01');
});

test('monthRange includes 31-day months fully', () => {
  const range = monthRange(2025, 1);
  assert.equal(formatDate(range.start), '2025-01-01');
  assert.equal(formatDate(range.end), '2025-02-01');
});
