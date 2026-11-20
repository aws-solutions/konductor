'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationService, WebSocketStub } = require('../src');

test('a socket close event removes its service registration', async () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  const socket = new WebSocketStub('event-close');
  try {
    app.connect('u1', socket);
    socket.close();
    assert.equal(app.listenerCount('u1'), 0);
    assert.equal(app.connectionCount('u1'), 0);
    await app.notify('u1', { ignored: true });
    assert.deepEqual(socket.sentMessages, []);
  } finally {
    app.close();
  }
});

test('an application handler failure is contained', async () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  try {
    app.subscribe('u1', () => { throw new Error('bad subscriber'); });
    await assert.doesNotReject(() => app.notify('u1', 'x'));
  } finally {
    app.close();
  }
});
