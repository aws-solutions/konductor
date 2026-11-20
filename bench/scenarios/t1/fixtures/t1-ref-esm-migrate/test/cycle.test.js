'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cycleValue } = require('../lib/cycle-value');

test('the mutually dependent helpers expose both values', () => {
  assert.equal(cycleValue(), 'cycle-a-cycle-b');
});
