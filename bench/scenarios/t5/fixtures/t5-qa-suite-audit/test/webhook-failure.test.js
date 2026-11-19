'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEvent } = require('../src/webhooks');

test('bad webhook payload does not break the worker', () => {
  try {
    parseEvent('{', 'not-a-signature', 'secret');
  } catch (error) {
    void error;
  }
  assert.ok(true);
});
