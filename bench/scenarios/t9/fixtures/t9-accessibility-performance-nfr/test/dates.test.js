import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, formatDate, daysBetween } from '../src/dates.js';

test('parses ISO dates', () => {
  assert.equal(parseDate('2025-03-14'), Date.UTC(2025, 2, 14));
});

test('parses day-first dates with slashes or dots', () => {
  assert.equal(parseDate('14/03/2025'), Date.UTC(2025, 2, 14));
  assert.equal(parseDate('4.3.2025'), Date.UTC(2025, 2, 4));
});

test('ignores spaces around the text', () => {
  assert.equal(parseDate('  2025-03-14 '), Date.UTC(2025, 2, 14));
});

test('rejects days that do not exist', () => {
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDate('31/04/2025'), null);
  assert.equal(parseDate('2025-13-01'), null);
});

test('knows leap years', () => {
  assert.notEqual(parseDate('2024-02-29'), null);
  assert.equal(parseDate('2025-02-29'), null);
});

test('rejects other shapes and empty text', () => {
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('March 14'), null);
  assert.equal(parseDate('2025/03/14'), null);
  assert.equal(parseDate(undefined), null);
});

test('formatDate round-trips', () => {
  assert.equal(formatDate(parseDate('09/01/2025')), '2025-01-09');
});

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween(parseDate('2025-03-01'), parseDate('2025-03-31')), 30);
});
