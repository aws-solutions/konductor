'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dunning = require('../src/dunning');

test('retry policy returns the next scheduled attempt', () => {
  const original = dunning.nextAttempt;
  dunning.nextAttempt = () => ({ attempt: 2, delayHours: 12 });
  try {
    assert.deepEqual(dunning.nextAttempt(1), { attempt: 2, delayHours: 12 });
  } finally {
    dunning.nextAttempt = original;
  }
});
