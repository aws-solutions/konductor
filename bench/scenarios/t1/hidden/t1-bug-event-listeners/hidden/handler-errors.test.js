'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus, NotificationService, WebSocketStub } = require('../src');

test('a synchronous handler failure does not stop later handlers', async () => {
  const bus = new EventBus();
  const calls = [];
  bus.subscribe('x', () => { calls.push('first'); throw new Error('bad'); });
  bus.subscribe('x', () => { calls.push('second'); });
  await assert.doesNotReject(() => bus.publish('x', 1));
  assert.deepEqual(calls, ['first', 'second']);
});

test('an asynchronous handler rejection does not stop later handlers', async () => {
  const bus = new EventBus();
  const calls = [];
  bus.subscribe('x', async () => { calls.push('first'); await Promise.resolve(); throw new Error('bad'); });
  bus.subscribe('x', async () => { calls.push('second'); });
  await bus.publish('x', 1);
  assert.deepEqual(calls, ['first', 'second']);
});

test('a failed application subscriber does not block the socket', async () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  const socket = new WebSocketStub('safe');
  try {
    app.connect('u1', socket);
    app.subscribe('u1', () => { throw new Error('broken app callback'); });
    await assert.doesNotReject(() => app.notify('u1', { ok: true }));
    assert.deepEqual(socket.sentMessages, [{ ok: true }]);
  } finally {
    app.close();
  }
});
