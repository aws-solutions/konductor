'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Heartbeat, WebSocketStub } = require('../src');

test('heartbeat can be started and stopped', () => {
  const socket = new WebSocketStub('heartbeat');
  const heartbeat = new Heartbeat(socket, 1000);
  heartbeat.start();
  assert.equal(heartbeat.running, true);
  heartbeat.stop();
  assert.equal(heartbeat.running, false);
});
