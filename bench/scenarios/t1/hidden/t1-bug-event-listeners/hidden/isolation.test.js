'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationService, WebSocketStub } = require('../src');

test('notifications stay scoped to their user', async () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  try {
    const one = new WebSocketStub('one');
    const two = new WebSocketStub('two');
    app.connect('u1', one);
    app.connect('u2', two);
    await app.notify('u1', 'only one');
    assert.deepEqual(one.sentMessages, ['only one']);
    assert.deepEqual(two.sentMessages, []);
  } finally {
    app.close();
  }
});

test('close is safe when called more than once', () => {
  const app = new NotificationService({ heartbeatIntervalMs: 60000 });
  try {
    app.connect('u1', new WebSocketStub('repeat'));
    app.close();
    assert.equal(app.listenerCount('u1'), 0);
    assert.doesNotThrow(() => app.close());
  } finally {
    app.close();
  }
});
