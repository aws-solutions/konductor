'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventStore } = require('../prototype/store');

test('event store returns copies scoped to a tenant', () => {
  const store = new EventStore();
  store.put({ eventId: 'evt-a', tenantId: 'tenant-a', payload: { amount: 4 }, storedAt: '2025-01-01T00:00:00Z' });
  store.put({ eventId: 'evt-b', tenantId: 'tenant-b', payload: { amount: 7 }, storedAt: '2025-01-01T00:00:00Z' });
  const result = store.list('tenant-a');
  assert.deepEqual(result.map((event) => event.eventId), ['evt-a']);
  result[0].payload.amount = 99;
  assert.equal(store.list('tenant-a')[0].payload.amount, 4);
});
