import test from 'node:test';
import assert from 'node:assert/strict';
import event from '../data/event.json' with { type: 'json' };

test('event data has a venue and capacity', () => {
  assert.equal(event.venue, 'Port Alder waterfront');
  assert.equal(typeof event.capacity, 'number');
});
