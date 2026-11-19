'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationService, WebSocketStub } = require('../src');

function service() { return new NotificationService({ heartbeatIntervalMs: 60000 }); }

test('connecting the same socket twice is idempotent', async () => {
  const app = service();
  const socket = new WebSocketStub('same');
  try {
    const first = app.connect('u1', socket);
    const second = app.connect('u1', socket);
    assert.strictEqual(first, second);
    assert.equal(app.listenerCount('u1'), 1);
    await app.notify('u1', { n: 1 });
    assert.equal(socket.sentMessages.length, 1);
  } finally {
    app.close();
  }
});

test('a disconnected socket receives nothing after a new connection arrives', async () => {
  const app = service();
  const oldSocket = new WebSocketStub('old');
  const newSocket = new WebSocketStub('new');
  try {
    app.connect('u1', oldSocket);
    app.disconnect('u1', oldSocket);
    app.connect('u1', newSocket);
    await app.notify('u1', { n: 2 });
    assert.equal(oldSocket.sentMessages.length, 0);
    assert.deepEqual(newSocket.sentMessages, [{ n: 2 }]);
  } finally {
    app.close();
  }
});

test('a reconnect delivers one copy', async () => {
  const app = service();
  const socket = new WebSocketStub('reconnect');
  try {
    app.connect('u1', socket);
    app.disconnect('u1', socket);
    app.connect('u1', socket);
    await app.notify('u1', 'once');
    assert.deepEqual(socket.sentMessages, ['once']);
  } finally {
    app.close();
  }
});
