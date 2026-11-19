'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_TYPES, normalizeEvent, InMemoryEventStore } = require('./index');

test('normalizes a known event and stores it', () => {
  const event = normalizeEvent({ type: EVENT_TYPES[0], accountId: 'acct_demo', data: { amount: 12 } });
  const store = new InMemoryEventStore();
  const saved = store.append(event);
  assert.equal(saved.type, 'payment.authorized');
  assert.equal(store.list('acct_demo').length, 1);
});

test('rejects an unknown event type', () => {
  assert.throws(() => normalizeEvent({ type: 'something.new', accountId: 'acct_demo' }), /unknown event/);
});
