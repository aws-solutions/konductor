'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationService, WebSocketStub } = require('../src');

function service() { return new NotificationService({ heartbeatIntervalMs: 60000 }); }

test('disconnect removes the connection listener', () => {
  const app = service();
  const socket = new WebSocketStub('cleanup');
  try {
    app.connect('u1', socket);
    assert.equal(app.listenerCount('u1'), 1);
    assert.equal(app.disconnect('u1', socket), true);
    assert.equal(app.listenerCount('u1'), 0);
    assert.equal(app.connectionCount('u1'), 0);
  } finally {
    app.close();
  }
});

test('disconnect stops the returned session heartbeat', () => {
  const app = service();
  const socket = new WebSocketStub('timer');
  try {
    const session = app.connect('u1', socket);
    app.disconnect('u1', socket);
    assert.equal(session.heartbeat.running, false);
    assert.equal(app.listenerCount('u1'), 0);
  } finally {
    app.close();
  }
});
