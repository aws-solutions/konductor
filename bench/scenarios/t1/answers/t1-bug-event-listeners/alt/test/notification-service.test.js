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
});

test('reconnecting same user replaces previous session', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const socket1 = new WebSocketStub('user1');
  const socket2 = new WebSocketStub('user2');
  service.connect('user', socket1);
  const session1 = service.sessions.get('user');
  service.connect('user', socket2);
  await service.notify('user', 'message');
  assert.deepEqual(socket2.sentMessages, ['message']);
  assert.equal(session1.heartbeat.running, false);
  assert.equal(service.connectionCount('user'), 1);
  service.close();
});

test('disconnect is idempotent', () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const socket = new WebSocketStub('test');
  service.connect('test', socket);
  assert.equal(service.disconnect('test', socket), true);
  assert.equal(service.disconnect('test', socket), false);
});

test('close is idempotent', () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const socket = new WebSocketStub('test');
  service.connect('test', socket);
  service.close();
  service.close();
  assert.equal(service.listenerCount('test'), 0);
});

test('one failing callback does not block others', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 1000 });
  const socket = new WebSocketStub('user');
  const received = [];
  service.subscribe('user', () => { throw new Error('fail'); });
  service.subscribe('user', (v) => received.push(v));
  service.connect('user', socket);
  await service.notify('user', 'msg');
  assert.deepEqual(received, ['msg']);
  assert.deepEqual(socket.sentMessages, ['msg']);
  service.close();
});

test('heartbeat stops on disconnect', async () => {
  const service = new NotificationService({ heartbeatIntervalMs: 10 });
  const socket = new WebSocketStub('user');
  const session = service.connect('user', socket);
  assert.equal(session.heartbeat.running, true);
  service.disconnect('user', socket);
  assert.equal(session.heartbeat.running, false);
});
