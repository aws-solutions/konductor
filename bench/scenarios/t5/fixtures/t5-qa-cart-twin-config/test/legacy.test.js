'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dollarsFromCents } = require('../src/legacy-rounding');

test('formats a report amount', () => {
  assert.equal(dollarsFromCents(1234), '12.34');
});
