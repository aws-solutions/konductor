'use strict';

const { isKnownEventType } = require('./event-types');

function normalizeEvent(input) {
  if (!input || typeof input !== 'object') throw new TypeError('event must be an object');
  if (!isKnownEventType(input.type)) throw new Error(`unknown event type: ${input.type}`);
  if (typeof input.accountId !== 'string' || input.accountId.length === 0) {
    throw new Error('accountId is required');
  }
  return {
    type: input.type,
    accountId: input.accountId,
    occurredAt: input.occurredAt || new Date().toISOString(),
    data: input.data && typeof input.data === 'object' ? { ...input.data } : {},
  };
}

module.exports = { normalizeEvent };
