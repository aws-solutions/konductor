'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatCents } = require('../src/pricing');

test('cents are shown as dollars with two decimals', () => {
  assert.equal(formatCents(1250), '$12.50');
  assert.equal(formatCents(5), '$0.05');
});
