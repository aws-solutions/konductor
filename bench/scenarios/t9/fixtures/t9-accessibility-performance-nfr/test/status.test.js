import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUSES, statusLabel, isKnownStatus } from '../src/status.js';

test('the filter lists All first', () => {
  assert.equal(STATUSES[0].value, 'all');
  assert.equal(STATUSES.length, 4);
});

test('labels are looked up by value', () => {
  assert.equal(statusLabel('shipped'), 'Shipped');
  assert.equal(statusLabel('lost'), 'lost');
});

test('knows which statuses exist', () => {
  assert.equal(isKnownStatus('delivered'), true);
  assert.equal(isKnownStatus('refunded'), false);
});
