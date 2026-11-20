'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationService, WebSocketStub } = require('../src');

test('connected user receives notifications', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const socket = new WebSocketStub('ada');
  service.connect('ada', socket);
  await service.notify('ada', { text: 'hello' });
  assert.deepEqual(socket.sentMessages, [{ text: 'hello' }]);
  service.close();
});

test('application subscribers receive user notifications', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const values = [];
  service.subscribe('lin', (value) => values.push(value));
  await service.notify('lin', 'notice');
  assert.deepEqual(values, ['notice']);
  service.close();
});

test('disconnect removes event listener to prevent memory leak', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const socket = new WebSocketStub('test');
  service.connect('test', socket);
  assert.equal(service.listenerCount('test'), 1);
  service.disconnect('test', socket);
  assert.equal(service.listenerCount('test'), 0);
  service.close();
});
