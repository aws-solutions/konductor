import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReviewDate } from '../src/date-format.js';

test('formatReviewDate uses a compact month name', () => {
  assert.equal(formatReviewDate('2025-02-14'), 'Feb 14, 2025');
  assert.equal(formatReviewDate('2024-10-01'), 'Oct 1, 2024');
});

test('formatReviewDate reports invalid input', () => {
  assert.equal(formatReviewDate('not-a-date'), 'Date unavailable');
});
