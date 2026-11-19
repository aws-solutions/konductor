'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationService, WebSocketStub } = require('../src');

test('service heartbeats do not keep the event loop referenced', () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  try {
    const session = app.connect('u1', new WebSocketStub('unref'));
    assert.equal(typeof session.heartbeat.timer.hasRef, 'function');
    assert.equal(session.heartbeat.timer.hasRef(), false);
  } finally {
    app.close();
  }
});

test('close stops every active heartbeat and removes listeners', () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  try {
    app.connect('u1', new WebSocketStub('a'));
    app.connect('u2', new WebSocketStub('b'));
    app.close();
    assert.equal(app.listenerCount('u1'), 0);
    assert.equal(app.listenerCount('u2'), 0);
    assert.equal(app.connectionCount('u1'), 0);
    assert.equal(app.connectionCount('u2'), 0);
  } finally {
    app.close();
  }
});
