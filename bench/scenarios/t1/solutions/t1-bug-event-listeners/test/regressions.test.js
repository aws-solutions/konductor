'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus, NotificationService, WebSocketStub } = require('../src');

test('reconnect keeps one delivery registration', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 60000 });
  const socket = new WebSocketStub('regression');
  service.connect('u', socket);
  service.disconnect('u', socket);
  service.connect('u', socket);
  await service.notify('u', 'message');
  assert.deepEqual(socket.sentMessages, ['message']);
  service.close();
});

test('publish continues after a rejected callback', async () => {
  const bus = new EventBus();
  const calls = [];
  bus.subscribe('topic', async () => { calls.push('bad'); throw new Error('expected'); });
  bus.subscribe('topic', () => calls.push('good'));
  await bus.publish('topic', null);
  assert.deepEqual(calls, ['bad', 'good']);
});

test('a service close removes a connection listener', () => {
  const service = new NotificationService({ heartbeatIntervalMs: 60000 });
  service.connect('u', new WebSocketStub('close'));
  service.close();
  assert.equal(service.listenerCount('u'), 0);
});

test('heartbeat timer is unreferenced', () => {
  const service = new NotificationService({ heartbeatIntervalMs: 60000 });
  const session = service.connect('u', new WebSocketStub('timer'));
  assert.equal(session.heartbeat.timer.hasRef(), false);
  service.close();
});
