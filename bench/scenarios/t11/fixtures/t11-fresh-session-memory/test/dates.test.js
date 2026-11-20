'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/dates.js');

test('parseDate accepts real dates only', () => {
  assert.equal(d.formatDate(d.parseDate('2026-02-28')), '2026-02-28');
  assert.throws(() => d.parseDate('2026-02-30'));
  assert.throws(() => d.parseDate('20261120'));
});

test('addDays and daysBetween cross month ends', () => {
  assert.equal(d.addDays('2026-11-29', 3), '2026-12-02');
  assert.equal(d.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(d.daysBetween('2026-11-06', '2026-11-09'), 3);
  assert.equal(d.daysBetween('2026-11-09', '2026-11-06'), -3);
});

test('weekends and office holidays are not business days', () => {
  assert.equal(d.isWeekend('2026-11-21'), true);
  assert.equal(d.isHoliday('2026-11-26'), true);
  assert.equal(d.isBusinessDay('2026-11-26'), false);
  assert.equal(d.isBusinessDay('2026-11-24'), true);
});
