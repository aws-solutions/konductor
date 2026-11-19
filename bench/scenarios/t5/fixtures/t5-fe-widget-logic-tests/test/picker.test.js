'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPicker, transition, isDateDisabled, daysInMonth, monthLabel } = require('../src/date-range-picker');

test('picker starts with a chosen month and moves forward', () => {
  const picker = createPicker({ year: 2025, month: 5 });
  const next = transition(picker, { type: 'NEXT_MONTH' });
  assert.deepEqual({ year: next.visibleYear, month: next.visibleMonth }, { year: 2025, month: 6 });
  assert.equal(daysInMonth(2025, 5), 31);
});

test('picker selects a start and end date', () => {
  let picker = createPicker({ year: 2025, month: 5 });
  picker = transition(picker, { type: 'SELECT_DATE', date: '2025-05-04' });
  picker = transition(picker, { type: 'SELECT_DATE', date: '2025-05-09' });
  assert.equal(picker.startDate, '2025-05-04');
  assert.equal(picker.endDate, '2025-05-09');
  assert.equal(isDateDisabled('2025-05-08', [{ start: '2025-05-10', end: '2025-05-12' }]), false);
});

test('picker can clear a selection and labels the month', () => {
  let picker = createPicker({ year: 2025, month: 5 });
  picker = transition(picker, { type: 'SELECT_DATE', date: '2025-05-04' });
  picker = transition(picker, { type: 'CLEAR' });
  assert.equal(picker.startDate, null);
  assert.equal(picker.endDate, null);
  assert.equal(monthLabel(2025, 5), 'May 2025');
});
