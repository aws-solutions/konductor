'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogger } = require('../src/logger');

test('quiet logger does not write info messages', () => {
  const calls = [];
  createLogger(false, { error: (message) => calls.push(message) }).info('hello');
  assert.deepEqual(calls, []);
});

test('verbose logger writes info messages', () => {
  const calls = [];
  createLogger(true, { error: (message) => calls.push(message) }).info('hello');
  assert.deepEqual(calls, ['[info] hello']);
});
