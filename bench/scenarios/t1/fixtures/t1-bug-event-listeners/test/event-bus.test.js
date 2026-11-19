'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus } = require('../src');

test('publishes a payload to topic subscribers', async () => {
  const bus = new EventBus();
  const received = [];
  bus.subscribe('updates', (value) => received.push(value));
  await bus.publish('updates', { id: 7 });
  assert.deepEqual(received, [{ id: 7 }]);
});

test('unsubscribe removes a topic subscriber', async () => {
  const bus = new EventBus();
  let count = 0;
  const remove = bus.subscribe('updates', () => { count += 1; });
  remove();
  await bus.publish('updates', 'ignored');
  assert.equal(count, 0);
});
