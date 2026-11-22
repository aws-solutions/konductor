'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oldMoney } = require('../src/legacy-format');

test('formats old dashboard money values', () => {
  assert.equal(oldMoney(2), '$2.00');
});
