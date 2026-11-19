'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WebSocketStub } = require('../src');

test('stub records messages and pings while open', () => {
  const socket = new WebSocketStub('test');
  socket.send({ ok: true });
  socket.ping();
  assert.deepEqual(socket.sentMessages, [{ ok: true }]);
  assert.equal(socket.pingCount, 1);
});

test('stub transitions to closed once', () => {
  const socket = new WebSocketStub('test');
  let closed = 0;
  socket.on('close', () => { closed += 1; });
  socket.close();
  socket.close();
  assert.equal(socket.readyState, 'CLOSED');
  assert.equal(closed, 1);
});
