'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_TYPES } = require('../src/events');

test('catalog has the four currently documented event names', () => {
  assert.deepEqual(EVENT_TYPES, [
    'payment.authorized',
    'payment.failed',
    'refund.created',
    'payout.completed',
  ]);
});
