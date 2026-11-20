'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTotal } = require('../src/pricing');

test('a zero quantity line has zero value at a regular discount', () => {
  assert.equal(lineTotal(99.99, 0, 25), 0);
});
