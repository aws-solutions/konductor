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

test('one failing handler does not prevent others from receiving', async () => {
  const bus = new EventBus();
  const received = [];
  bus.subscribe('topic', () => { throw new Error('fail'); });
  bus.subscribe('topic', (value) => received.push(value));
  await bus.publish('topic', 'payload');
  assert.deepEqual(received, ['payload']);
});

test('async handlers are all awaited', async () => {
  const bus = new EventBus();
  const order = [];
  bus.subscribe('topic', async () => {
    await new Promise(r => setTimeout(r, 10));
    order.push('first');
  });
  bus.subscribe('topic', () => order.push('second'));
  await bus.publish('topic', 'payload');
  assert.deepEqual(order, ['second', 'first']);
});
