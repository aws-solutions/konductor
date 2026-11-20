// Changes for this request; see the commit message for the reasoning.
const test = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../src/calendar');

test('recognizes a reminder in a supplied instant', () => {
  const instant = new Date('2026-04-06T09:15:00.000Z');
  const rule = { weekday: calendar.weekdayFor(instant, 'UTC'), hour: 9, minute: 15 };
  assert.equal(calendar.isDue(rule, instant, 'UTC'), true);
});

test('parses and rejects calendar rule text', () => {
  assert.deepEqual(calendar.ruleFromText('Monday 09:05'), { weekday: 'Monday', hour: 9, minute: 5 });
  assert.throws(() => calendar.ruleFromText('Monday 25:00'), /invalid/);
});

test('finds a later weekday occurrence', () => {
  const start = new Date('2026-04-06T08:00:00.000Z');
  const result = calendar.nextOccurrence({ weekday: 'Friday', hour: 10, minute: 30 }, start, 'UTC');
  assert.equal(result.toISOString(), '2026-04-10T10:30:00.000Z');
});

test('uses the expected weekday for a known UTC instant', () => {
  const instant = new Date('2026-04-05T00:30:00.000Z');
  assert.equal(calendar.weekdayFor(instant, 'UTC'), 'Sunday');
  const result = calendar.localParts(new Date('2026-04-06T12:34:00.000Z'), 'UTC');
  assert.deepEqual(result, { year: 2026, month: 4, day: 6, hour: 12, minute: 34 });
});
