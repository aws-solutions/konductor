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

test('a started Heartbeat does not hold the event loop open', () => {
  const { Heartbeat } = require('../src');
  const heartbeat = new Heartbeat(new WebSocketStub('direct'), 60000).start();
  try {
    assert.equal(heartbeat.running, true);
    assert.equal(heartbeat.timer.hasRef(), false);
  } finally {
    heartbeat.stop();
  }
  assert.equal(heartbeat.running, false);
});

test('a heartbeat stops when its socket closes', () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  try {
    const socket = new WebSocketStub('closing');
    const session = app.connect('u1', socket);
    socket.close();
    assert.equal(session.heartbeat.running, false);
  } finally {
    app.close();
  }
});

test('a process with a live connection exits on its own when its work is done', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const code = "const { NotificationService, WebSocketStub } = require('./src'); const app = new NotificationService({ heartbeatIntervalMs: 50 }); app.connect('u1', new WebSocketStub('left-open')); app.notify('u1', { ok: true });";
  const result = spawnSync(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), timeout: 5000, encoding: 'utf8' });
  assert.equal(result.signal, null, 'the process was still running after 5 seconds');
  assert.equal(result.status, 0);
});
