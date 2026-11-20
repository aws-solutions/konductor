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

test('heartbeat timer does not keep process alive', (t, done) => {
  const socket = new WebSocketStub('heartbeat');
  const heartbeat = new Heartbeat(socket, 10);
  heartbeat.start();
  heartbeat.stop();
  setImmediate(() => {
    assert.equal(heartbeat.running, false);
    done();
  });
});

test('start is idempotent', () => {
  const socket = new WebSocketStub('heartbeat');
  const heartbeat = new Heartbeat(socket, 1000);
  heartbeat.start();
  const timer1 = heartbeat.timer;
  heartbeat.start();
  assert.equal(heartbeat.timer, timer1);
  heartbeat.stop();
});

test('stop is idempotent', () => {
  const socket = new WebSocketStub('heartbeat');
  const heartbeat = new Heartbeat(socket, 1000);
  heartbeat.stop();
  assert.equal(heartbeat.running, false);
  heartbeat.start();
  heartbeat.stop();
  heartbeat.stop();
  assert.equal(heartbeat.running, false);
});
