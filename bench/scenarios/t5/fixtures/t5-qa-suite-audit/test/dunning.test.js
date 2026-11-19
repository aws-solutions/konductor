'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextAttempt, shouldRetry, recordFailure } = require('../src/dunning');

test('retry delays advance and stop at the limit', () => {
  assert.deepEqual(nextAttempt(0), { attempt: 1, delayHours: 1 });
  assert.deepEqual(nextAttempt(3), { attempt: 4, delayHours: 120 });
  assert.equal(nextAttempt(4), null);
});

test('only retryable failures are scheduled', () => {
  assert.equal(shouldRetry({ status: 'failed', retryable: true }), true);
  assert.equal(shouldRetry({ status: 'failed', retryable: false }), false);
  assert.equal(shouldRetry({ status: 'succeeded' }), false);
});

test('terminal failure becomes past due', () => {
  const invoice = recordFailure({ id: 'inv', attempts: 4 }, { status: 'failed', retryable: true, code: 'declined' });
  assert.equal(invoice.status, 'past_due');
  assert.equal(invoice.lastFailure, 'declined');
});
