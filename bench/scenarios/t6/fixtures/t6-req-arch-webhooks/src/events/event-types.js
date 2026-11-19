'use strict';

const EVENT_TYPES = Object.freeze([
  'payment.authorized',
  'payment.failed',
  'refund.created',
  'payout.completed',
]);

function isKnownEventType(value) {
  return typeof value === 'string' && EVENT_TYPES.includes(value);
}

module.exports = { EVENT_TYPES, isKnownEventType };
