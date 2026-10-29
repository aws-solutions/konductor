'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { centsFromTotal } = require('../src/money');

test('whole and half amounts', () => {
  assert.equal(centsFromTotal(5), 500);
  assert.equal(centsFromTotal(10.5), 1050);
  assert.equal(centsFromTotal('7.25'), 725);
});
